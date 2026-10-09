import {canvasDocument} from '../../src/canvas-document.ts';
import {canvasPreviewDocument} from '../../src/canvas-preview-document.ts';
import type {Canvas} from '../../src/shared.ts';
import type {CanvasAppearance} from '../../src/canvas-theme.ts';
export const documentFor=(canvas:Canvas,token:string,appearance:CanvasAppearance)=>canvasDocument(canvas.html,canvas.state,token,appearance,canvas.rubric,canvas.quizAnswers,'android');
export const previewFor=(token:string,appearance:CanvasAppearance)=>canvasPreviewDocument(token,appearance,'android');
