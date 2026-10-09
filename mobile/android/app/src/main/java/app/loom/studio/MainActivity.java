package app.loom.studio;

import android.app.Activity;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import android.content.*;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.*;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;

public final class MainActivity extends ComponentActivity {
    private static final String ORIGIN="https://appassets.androidplatform.net", HOME=ORIGIN+"/assets/index.html";
    private final ExecutorService jobs=Executors.newFixedThreadPool(4);
    private WebView web;
    private Connection connection;
    private volatile HttpsURLConnection events;
    private volatile int streamGeneration=0;
    private volatile boolean resumed=false;
    private final Handler ui=new Handler(Looper.getMainLooper());
    private final List<JSONObject> eventBatch=new ArrayList<>();
    private boolean eventScheduled=false;
    private final LinkedHashMap<String,String> lessonDocuments=new LinkedHashMap<>();
    private boolean wantsEvents=false;
    private String launchCode="";
    private String theme="system";
    private JavaScriptReplyProxy fileReply,scanReply;
    private String fileRequest,fileChat,scanRequest;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state); connection=new Connection(getApplicationContext());
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){if(web!=null)web.evaluateJavascript("window.dispatchEvent(new Event('loom-back'))",null);}});
        readIntent(getIntent());
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(250,251,249));setContentView(root);
        root.setOnApplyWindowInsetsListener((view,insets)->{
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets system=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());view.setPadding(system.left,system.top,system.right,system.bottom);}
            else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        web=new WebView(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        web.setBackgroundColor(Color.rgb(250,251,249));
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);settings.setMediaPlaybackRequiresUserGesture(true);settings.setTextZoom(100);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        WebViewAssetLoader assets=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if("https".equals(request.getUrl().getScheme())&&"lessons.loom.local".equals(request.getUrl().getHost())){
                    String id=request.getUrl().getLastPathSegment(),html; synchronized(lessonDocuments){html=lessonDocuments.get(id);}
                    if(html!=null){Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");headers.put("Content-Security-Policy","default-src 'none'; script-src 'unsafe-inline' "+ORIGIN+"; style-src 'unsafe-inline' "+ORIGIN+"; img-src data: blob: "+ORIGIN+"; font-src data: "+ORIGIN+"; media-src data: blob: "+ORIGIN+"; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'");return new WebResourceResponse("text/html","UTF-8",200,"OK",headers,new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));}
                }
                WebResourceResponse asset=assets.shouldInterceptRequest(request.getUrl());if(asset!=null){Map<String,String> headers=new HashMap<>();if(asset.getResponseHeaders()!=null)headers.putAll(asset.getResponseHeaders());headers.put("Access-Control-Allow-Origin","*");headers.put("X-Content-Type-Options","nosniff");asset.setResponseHeaders(headers);return asset;}return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(!request.isForMainFrame()&&"https".equals(request.getUrl().getScheme())&&"lessons.loom.local".equals(request.getUrl().getHost())){synchronized(lessonDocuments){return !lessonDocuments.containsKey(request.getUrl().getLastPathSegment());}}return true;}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();}
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){stopEvents();root.removeView(view);view.destroy();TextView message=new TextView(MainActivity.this);message.setText("The lesson renderer stopped. Tap to reopen Loom. Your chat is saved.");message.setPadding(24,24,24,24);message.setTextSize(18);message.setOnClickListener(v->recreate());root.addView(message);return true;}
        });
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){TextView message=new TextView(this);message.setText("Update Android System WebView to use Loom.");root.removeAllViews();root.addView(message);return;}
        WebViewCompat.addWebMessageListener(web,"LoomAndroid",Collections.singleton(ORIGIN),(view,message,origin,mainFrame,reply)->{
            // An origin alone is insufficient: generated lessons are always child frames.
            if(!mainFrame||!ORIGIN.equals(origin.toString()))return;
            String raw=message.getData();if(raw==null||raw.length()>40*1024*1024)return;
            String requestId=null;
            try {
                JSONObject request=new JSONObject(raw);String id=request.getString("id"),method=request.getString("method");JSONObject data=request.optJSONObject("data");if(data==null)data=new JSONObject();
                requestId=id;
                if(id.length()>100||method.length()>80)return;
                JSONObject input=data;
                if(method.equals("pickFiles")){pickFiles(id,input,reply);return;}
                if(method.equals("scanPair")){if(scanReply!=null)throw new IOException("A scanner is already open.");scanReply=reply;scanRequest=id;new IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("Scan the code in desktop Loom Settings → Phone").setBeepEnabled(false).setOrientationLocked(false).initiateScan();return;}
                if(method.equals("startEvents")){wantsEvents=true;if(resumed)startEvents();respond(reply,id,null,null);return;}
                if(method.equals("stopEvents")){wantsEvents=false;stopEvents();respond(reply,id,null,null);return;}
                if(method.equals("background")){moveTaskToBack(true);respond(reply,id,null,null);return;}
                if(method.equals("appearance")){theme=input.optString("theme","system");applyBars();respond(reply,id,null,null);return;}
                if(method.equals("openExternal")){String url=input.getString("url");Uri target=Uri.parse(url);if(!("https".equals(target.getScheme())||"http".equals(target.getScheme()))||target.getHost()==null)throw new IOException("Only web links can be opened.");startActivity(new Intent(Intent.ACTION_VIEW,target));respond(reply,id,null,null);return;}
                jobs.execute(()->{
                    try {
                        Object result;
                        switch(method){
                            case "status":result=connection.status().put("systemDark",systemDark());break;
                            case "launchCode":result=launchCode;launchCode="";break;
                            case "pair":stopEvents();connection.pair(input.getString("code"));result=connection.status();break;
                            case "disconnect":wantsEvents=false;stopEvents();connection.clear();synchronized(eventBatch){eventBatch.removeIf(event->!event.optString("type").equals("pair-code")&&!event.optString("type").equals("system-theme"));}new File(getFilesDir(),"lesson-cache.json").delete();result=null;break;
                            case "rpc":result=connection.rpc(input.getString("method"),input.optJSONObject("data")==null?new JSONObject():input.getJSONObject("data"));break;
                            case "renderDocument":{
                                String documentId=input.getString("id"),html=input.getString("html");if(!documentId.matches("[a-f0-9-]{36}")||html.length()>4*1024*1024)throw new IOException("This lesson is too large to render.");
                                synchronized(lessonDocuments){lessonDocuments.put(documentId,html);long size=0;for(String value:lessonDocuments.values())size+=value.length();while(size>20*1024*1024&&lessonDocuments.size()>1){String first=lessonDocuments.keySet().iterator().next();size-=lessonDocuments.remove(first).length();}}
                                result="https://lessons.loom.local/document/"+documentId;break;
                            }
                            case "releaseDocument":synchronized(lessonDocuments){lessonDocuments.remove(input.getString("id"));}result=null;break;
                            case "loadCache":{File file=new File(getFilesDir(),"lesson-cache.json");result=file.exists()?new JSONObject(Connection.read(new FileInputStream(file),32*1024*1024)):null;break;}
                            case "saveCache":{byte[] bytes=input.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>32*1024*1024)throw new IOException("The offline cache is full.");File temp=new File(getFilesDir(),"lesson-cache.tmp"),target=new File(getFilesDir(),"lesson-cache.json");try(FileOutputStream out=new FileOutputStream(temp)){out.write(bytes);out.getFD().sync();}Files.move(temp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);result=null;break;}
                            default:throw new IOException("Unknown phone action.");
                        }
                        respond(reply,id,result,null);
                    }catch(Exception e){respond(reply,id,null,failure(e));}
                });
            }catch(Exception e){if(requestId!=null)respond(reply,requestId,null,failure(e));}
        });
        web.loadUrl(HOME);
    }
    private void pickFiles(String id,JSONObject input,JavaScriptReplyProxy reply) throws Exception {
        if(fileReply!=null)throw new IOException("A file picker is already open.");fileChat=input.getString("chatId");fileRequest=id;fileReply=reply;
        Intent picker=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);startActivityForResult(picker,4001);
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent intent){
        super.onActivityResult(requestCode,resultCode,intent);
        IntentResult scan=IntentIntegrator.parseActivityResult(requestCode,resultCode,intent);
        if(scan!=null&&scanReply!=null){respond(scanReply,scanRequest,scan.getContents()==null?"":scan.getContents(),null);scanReply=null;return;}
        if(requestCode!=4001||fileReply==null)return;
        JavaScriptReplyProxy reply=fileReply;String id=fileRequest,chat=fileChat;fileReply=null;
        if(resultCode!=RESULT_OK||intent==null){respond(reply,id,new JSONArray(),null);return;}
        List<Uri> files=new ArrayList<>();if(intent.getClipData()!=null){for(int i=0;i<Math.min(12,intent.getClipData().getItemCount());i++)files.add(intent.getClipData().getItemAt(i).getUri());}else if(intent.getData()!=null)files.add(intent.getData());
        jobs.execute(()->{
            JSONArray uploaded=new JSONArray();String failure=null;
            try { for(Uri uri:files){
                String name="Attachment";try(Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)){if(cursor!=null&&cursor.moveToFirst()){name=cursor.getString(0);if(!cursor.isNull(1)&&cursor.getLong(1)>20*1024*1024)throw new IOException("Attach files of at most 20 MB.");}}
                String mime=getContentResolver().getType(uri);if(mime==null)mime="application/octet-stream";
                ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("Could not read the selected file.");byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>20*1024*1024)throw new IOException("Attach files of at most 20 MB.");out.write(buffer,0,n);}}
                uploaded.put(connection.rpc("mobileUpload",new JSONObject().put("chatId",chat).put("name",name).put("mime",mime).put("bytes",android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP))));
            }}catch(Exception e){failure=failure(e);}
            // Earlier uploads remain attached if a later file fails.
            try{respond(reply,id,new JSONObject().put("attachments",uploaded).put("error",failure==null?JSONObject.NULL:failure),null);}catch(JSONException e){respond(reply,id,null,"The attachment could not be read.");}
        });
    }
    private synchronized void stopEvents(){streamGeneration++;HttpsURLConnection prior=events;events=null;if(prior!=null)prior.disconnect();}
    private synchronized void startEvents(){
        stopEvents();final int generation=streamGeneration;
        new Thread(()->{
            int delay=1000;
            while(resumed&&wantsEvents&&generation==streamGeneration){
                HttpsURLConnection stream=null;
                try{
                    stream=connection.open("/events",true);events=stream;int status=stream.getResponseCode();
                    if(status!=200){String error="The desktop is unavailable ("+status+").";if(status==401){error="This phone was revoked. Pair again from desktop Settings → Phone.";wantsEvents=false;}throw new IOException(error);}
                    if(generation!=streamGeneration)break;
                    emit(new JSONObject().put("type","connection").put("online",true));delay=1000;
                    BufferedReader reader=new BufferedReader(new InputStreamReader(stream.getInputStream(),StandardCharsets.UTF_8));String line;
                    while(resumed&&generation==streamGeneration&&(line=reader.readLine())!=null){if(line.length()>32*1024*1024)throw new IOException("The lesson is too large.");if(line.startsWith("data: "))emit(new JSONObject(line.substring(6)));}
                    if(resumed&&generation==streamGeneration)throw new IOException("The desktop connection closed. Reconnecting.");
                }catch(Exception e){if(resumed&&generation==streamGeneration){try{emit(new JSONObject().put("type","connection").put("online",false).put("error",failure(e)));}catch(Exception ignored){}}}
                finally{if(stream!=null)stream.disconnect();if(events==stream)events=null;}
                if(!resumed||!wantsEvents||generation!=streamGeneration)break;
                try{Thread.sleep(delay);}catch(InterruptedException e){break;}delay=Math.min(15000,delay*2);
            }
        },"loom-events").start();
    }
    private void respond(JavaScriptReplyProxy reply,String id,Object result,String error){try{String text=new JSONObject().put("id",id).put("result",result==null?JSONObject.NULL:result).put("error",error==null?JSONObject.NULL:error).toString();runOnUiThread(()->{if(!isDestroyed())reply.postMessage(text);});}catch(Exception ignored){}}
    private void emit(JSONObject event){synchronized(eventBatch){eventBatch.add(event);if(eventScheduled)return;eventScheduled=true;}ui.postDelayed(()->{JSONArray batch; synchronized(eventBatch){batch=new JSONArray(eventBatch);eventBatch.clear();eventScheduled=false;}if(web!=null&&!isDestroyed()&&HOME.equals(web.getUrl()))web.evaluateJavascript("JSON.parse("+JSONObject.quote(batch.toString())+").forEach(detail=>window.dispatchEvent(new CustomEvent('loom-native-event',{detail})))",null);},16);}
    private String failure(Exception e){if(e instanceof javax.net.ssl.SSLException)return "The desktop certificate does not match. Check the pairing code and pair again.";if(e instanceof java.net.ConnectException||e instanceof java.net.SocketTimeoutException)return "Desktop Loom is unavailable. Keep it open on the same Wi-Fi or private VPN.";String message=e.getMessage();return message==null?"The action failed. Try again when the desktop is available.":message.substring(0,Math.min(1500,message.length()));}
    private void readIntent(Intent intent){if(intent!=null&&intent.getData()!=null&&"loom".equals(intent.getData().getScheme())&&"pair".equals(intent.getData().getHost())&&intent.getData().toString().length()<4096)launchCode=intent.getData().toString();}
    private boolean systemDark(){return(getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;}
    private void applyBars(){boolean dark=theme.equals("dark")||theme.equals("system")&&systemDark();int color=dark?Color.rgb(24,30,28):Color.rgb(250,251,249);web.setBackgroundColor(color);getWindow().getDecorView().setBackgroundColor(color);if(Build.VERSION.SDK_INT>=30)getWindow().getInsetsController().setSystemBarsAppearance(dark?0:android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);else getWindow().getDecorView().setSystemUiVisibility(dark?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);}
    @Override public void onConfigurationChanged(Configuration next){super.onConfigurationChanged(next);applyBars();try{emit(new JSONObject().put("type","system-theme").put("dark",systemDark()));}catch(Exception ignored){}}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);readIntent(intent);try{emit(new JSONObject().put("type","pair-code").put("code",launchCode));}catch(Exception ignored){}}
    @Override protected void onResume(){super.onResume();resumed=true;if(wantsEvents)startEvents();}
    @Override protected void onPause(){resumed=false;stopEvents();super.onPause();}
    @Override protected void onDestroy(){wantsEvents=false;stopEvents();jobs.shutdownNow();if(web!=null)web.destroy();super.onDestroy();}
}
