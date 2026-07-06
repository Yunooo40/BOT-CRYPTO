"use server";

import { redirect } from "next/navigation";
import { clearSessionToken, setSessionToken } from "@/lib/auth";
import { env } from "@/lib/env";

export async function login(
  _previousError: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email === "" ||
    password === ""
  ) {
    return "Email et mot de passe requis";
  }

  const response = await fetch(`${env.API_GATEWAY_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  if (!response.ok) {
    return "Identifiants invalides";
  }

  const body = (await response.json()) as { token: string; expiresInSeconds: number };
  await setSessionToken(body.token, body.expiresInSeconds);
  redirect("/positions");
}

export async function logout(): Promise<void> {
  await clearSessionToken();
  redirect("/login");
}
