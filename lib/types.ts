export type MeetingStatus='uploaded'|'processing'|'completed'|'failed';
export type TaskType='feature'|'bug'|'improvement'|'technical-task'|'research';
export type Priority='low'|'medium'|'high';
export type Meeting={id:string;inputType:'recording'|'notes';title:string;meetingType:string;context:string|null;originalFileName:string;fileUrl:string;fileSize:number;duration:number|null;status:MeetingStatus;stage:string|null;progress:number;error:string|null;diagnostic:string|null;transcript:string|null;summary:string|null;topics:string[];decisions:string[];createdAt:string;updatedAt:string};
export type Task={id:string;meetingId:string;title:string;description:string;type:TaskType;priority:Priority;assignee:string|null;deadline:string|null;context:string;sourceTimestamp:string|null;acceptanceCriteria:string[];sourceQuote:string|null;confidence:number|null;status:'draft'|'approved';createdAt:string;updatedAt:string};
export type Analysis={summary:string;topics:string[];decisions:string[];tasks:Omit<Task,'id'|'meetingId'|'status'|'createdAt'|'updatedAt'>[]};
