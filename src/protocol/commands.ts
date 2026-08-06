


export interface RunTaskCommand {
  type: "run_task";
  task: string;
}

export interface CancelTaskCommand {
  type: "cancel_task";
}

export type AgentCommand = RunTaskCommand | CancelTaskCommand;
