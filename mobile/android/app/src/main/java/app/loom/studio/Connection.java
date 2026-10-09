package app.loom.studio;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.io.*;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.*;
import java.util.Arrays;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.*;

/** Pairing secrets stay in native storage and are encrypted by an Android Keystore key. */
final class Connection {
    private static final String ALIAS = "loom-phone-pairing-v1";
    private final Context context;
    private volatile JSONObject pairing;
    private volatile long generation=0;
    Connection(Context context) { this.context = context; }
    synchronized JSONObject load() throws Exception {
        if (pairing != null) return pairing;
        String encrypted = context.getSharedPreferences("pairing", Context.MODE_PRIVATE).getString("connection", null);
        if (encrypted == null) return null;
        byte[] bytes = Base64.decode(encrypted, Base64.NO_WRAP);
        if (bytes.length < 29) throw new IOException("The saved connection is invalid. Pair again.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOfRange(bytes, 0, 12)));
        pairing = validate(new JSONObject(new String(cipher.doFinal(Arrays.copyOfRange(bytes, 12, bytes.length)), StandardCharsets.UTF_8)));
        return pairing;
    }
    synchronized void pair(String code) throws Exception {
        if (code.length() > 4096) throw new IOException("Invalid pairing code.");
        android.net.Uri uri = android.net.Uri.parse(code.trim());
        if (!"loom".equals(uri.getScheme()) || !"pair".equals(uri.getHost())) throw new IOException("Paste the pairing code from desktop Settings → Phone.");
        String encoded = uri.getQueryParameter("code");
        if (encoded == null) throw new IOException("The pairing code is incomplete.");
        JSONObject next = validate(new JSONObject(new String(Base64.decode(encoded, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), StandardCharsets.UTF_8)));
        // Confirm the certificate pin and token before replacing a working connection.
        rpc(next, "state", new JSONObject());
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream output = new ByteArrayOutputStream(); output.write(cipher.getIV()); output.write(encrypted);
        if (!context.getSharedPreferences("pairing", Context.MODE_PRIVATE).edit().putString("connection", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)).commit()) throw new IOException("Could not save the connection.");
        generation++; pairing = next;
    }
    synchronized void clear() { generation++; pairing = null; context.getSharedPreferences("pairing", Context.MODE_PRIVATE).edit().clear().commit(); }
    JSONObject status() throws Exception { JSONObject saved = load(); return new JSONObject().put("paired", saved != null).put("url", saved == null ? "" : saved.getString("url")); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    static boolean privateHost(String host) {
        String[] parts = host.split("\\."); if (parts.length != 4) return false;
        int[] p = new int[4]; try { for (int i=0;i<4;i++) { if (!parts[i].matches("[0-9]{1,3}")) return false; p[i]=Integer.parseInt(parts[i]); if(p[i]>255) return false; } } catch (Exception e) { return false; }
        return p[0]==10 || p[0]==127 || p[0]==192&&p[1]==168 || p[0]==172&&p[1]>=16&&p[1]<=31 || p[0]==169&&p[1]==254 || p[0]==100&&p[1]>=64&&p[1]<=127;
    }
    private static JSONObject validate(JSONObject value) throws Exception {
        URI uri = new URI(value.getString("url"));
        if (value.getInt("version") != 1 || !"https".equals(uri.getScheme()) || !privateHost(uri.getHost()==null?"":uri.getHost()) || uri.getUserInfo()!=null || uri.getRawQuery()!=null || uri.getFragment()!=null || !(uri.getPath().isEmpty()||uri.getPath().equals("/")) || uri.getPort()<1 || uri.getPort()>65535 || !value.getString("fingerprint").matches("[a-f0-9]{64}") || !value.getString("token").matches("[A-Za-z0-9_-]{43}")) throw new IOException("Invalid desktop pairing code.");
        return value;
    }
    HttpsURLConnection open(String path, boolean stream) throws Exception { JSONObject saved = load(); if(saved==null) throw new IOException("Connect to desktop Loom first."); return open(saved,path,stream); }
    private static HttpsURLConnection open(JSONObject saved, String path, boolean stream) throws Exception {
        byte[] expected = hex(saved.getString("fingerprint"));
        X509TrustManager pins = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            public void checkClientTrusted(X509Certificate[] chain, String type) throws CertificateException { throw new CertificateException("Client certificates are not accepted."); }
            public void checkServerTrusted(X509Certificate[] chain, String type) throws CertificateException {
                try { if(chain==null||chain.length==0) throw new CertificateException("Missing desktop certificate."); chain[0].checkValidity(); if(!MessageDigest.isEqual(expected,MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded()))) throw new CertificateException("The desktop certificate has changed. Pair again."); } catch(GeneralSecurityException e) { throw new CertificateException("The desktop certificate does not match the pairing code.",e); }
            }
        };
        SSLContext tls = SSLContext.getInstance("TLS"); tls.init(null,new TrustManager[]{pins},null);
        HttpsURLConnection connection = (HttpsURLConnection) new URL(saved.getString("url").replaceAll("/$","")+path).openConnection();
        connection.setSSLSocketFactory(tls.getSocketFactory());
        // The paired identity is the exact leaf certificate, rather than a DNS name.
        connection.setHostnameVerifier((hostname,session)->{ try { return MessageDigest.isEqual(expected,MessageDigest.getInstance("SHA-256").digest(session.getPeerCertificates()[0].getEncoded())); } catch(Exception e) { return false; } });
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(8000); connection.setReadTimeout(stream?45000:125000);
        connection.setRequestProperty("Authorization","Bearer "+saved.getString("token")); connection.setRequestProperty("Accept",stream?"text/event-stream":"application/json");
        return connection;
    }
    Object rpc(String method, JSONObject data) throws Exception { long epoch=generation;JSONObject saved=load(); if(saved==null)throw new IOException("Connect to desktop Loom first.");Object result=rpc(saved,method,data);if(epoch!=generation)throw new IOException("The desktop connection changed. Try again.");return result; }
    private static Object rpc(JSONObject saved,String method,JSONObject data) throws Exception {
        HttpsURLConnection connection = open(saved,"/rpc",false);
        try {
            connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type","application/json");
            byte[] body=new JSONObject().put("method",method).put("data",data).toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(body.length);
            try(OutputStream out=connection.getOutputStream()){out.write(body);}
            int status=connection.getResponseCode(); InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();
            JSONObject reply=new JSONObject(read(input,40*1024*1024));
            if(reply.has("error"))throw new IOException(reply.getString("error"));
            if(status!=200)throw new IOException("The desktop connection failed ("+status+"). Try again when it is available.");
            return reply.opt("result");
        } finally { connection.disconnect(); }
    }
    static String read(InputStream input,int maximum) throws IOException {
        if(input==null)throw new IOException("The desktop sent no response.");
        try(input;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int size;while((size=input.read(buffer))!=-1){if(out.size()+size>maximum)throw new IOException("The response is too large.");out.write(buffer,0,size);}return new String(out.toByteArray(),StandardCharsets.UTF_8);}
    }
    private static byte[] hex(String value){byte[] result=new byte[value.length()/2];for(int i=0;i<result.length;i++)result[i]=(byte)Integer.parseInt(value.substring(i*2,i*2+2),16);return result;}
}
