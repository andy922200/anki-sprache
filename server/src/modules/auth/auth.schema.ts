import { z } from 'zod'

export const googleLoginSchema = z.object({
  idToken: z.string().min(10),
})
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>

export const userDto = z.object({
  id: z.string(),
  email: z.email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  timezone: z.string(),
})
export type UserDto = z.infer<typeof userDto>

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: userDto,
})
