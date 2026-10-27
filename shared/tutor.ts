import { z } from "zod";
export const modes = ["hint", "steps", "answer"] as const;
export const tutorSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  mode: z.enum(modes),
  context: z.object({
    title: z.string().max(250),
    page: z.number().int().min(1),
    text: z.string().max(16000),
    image: z
      .string()
      .max(4_000_000)
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
      .optional(),
  }),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(12000),
      }),
    )
    .max(12),
});
export type TutorRequest = z.infer<typeof tutorSchema>;
export interface TutorReply {
  answer: string;
  provider: "demo" | "openai";
}
export interface TutorProvider {
  answer(input: TutorRequest): Promise<TutorReply>;
}
