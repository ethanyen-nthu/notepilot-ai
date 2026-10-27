export interface Course {
  id: string;
  name: string;
  color: string;
}
export interface NoteDocument {
  id: string;
  courseId: string;
  title: string;
  kind: "pdf" | "image";
  blob: Blob;
  added: string;
}
export interface SavedAnswer {
  id: string;
  documentId: string;
  title: string;
  page: number;
  question: string;
  answer: string;
  provider: "demo" | "openai";
  created: string;
}
export interface Library {
  courses: Course[];
  documents: NoteDocument[];
  saved: SavedAnswer[];
}
export interface PageContext {
  text: string;
  image: string;
}
