import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ChartLineIcon, SignInIcon } from "@phosphor-icons/react";
import { authClient } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const res = await authClient.signIn.email({ email, password });
    setSubmitting(false);
    if (res.error) {
      toast.error("Sign-in failed", {
        description: res.error.message ?? "Check your email and password.",
      });
      return;
    }
    void navigate(next, { replace: true });
    window.location.reload();
  };

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center bg-primary text-primary-foreground">
            <ChartLineIcon className="size-4" weight="fill" />
          </div>
          <CardTitle>Sign in to open-agents</CardTitle>
          <CardDescription>
            Welcome back. Enter your credentials to access your agents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} id="login-form">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <FieldDescription>
                  Accounts are created by an admin. Ask yours for an invite.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>
          <Button
            form="login-form"
            type="submit"
            size="lg"
            className="w-full"
            disabled={submitting}
          >
            {submitting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SignInIcon data-icon="inline-start" />
            )}
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
