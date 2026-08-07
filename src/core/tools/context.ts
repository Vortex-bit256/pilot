import type { ToolProgress } from "../../protocol/index.js";


export interface ToolContext {

  cwd: string;

  signal?: AbortSignal;


  onProgress?: (progress: ToolProgress) => void;
}

