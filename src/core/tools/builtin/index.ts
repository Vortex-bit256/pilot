import type { AnyTool } from "../tool.js";
import { editFileTool } from "./editFile.js";
import { listFilesTool } from "./listFiles.js";
import { readFileTool } from "./readFile.js";
import { runCommandTool } from "./runCommand.js";
import { writeFileTool } from "./writeFile.js";


export const builtinTools: AnyTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  runCommandTool,
];
