import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ClockCounterClockwiseIcon,
  ClockIcon,
  DesktopIcon,
  LockKeyIcon,
  SignOutIcon,
  SunIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  useAuthSessions,
  useCurrentSession,
  useCurrentUser,
  useProfileSummary,
  type AuthSessionInfo,
} from "@/lib/queries";
import { authClient } from "@/lib/auth";

export default function ProfilePage() {
  const qc = useQueryClient();
  const me = useCurrentUser();
  const summary = useProfileSummary();
  const sessions = useAuthSessions();
  const currentSession = useCurrentSession();
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);

  const currentSessionId = currentSession.data?.session.id ?? null;
  const sortedSessions = useMemo(
    () =>
      [...(sessions.data ?? [])].sort(
        (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt),
      ),
    [sessions.data],
  );

  const updateProfile = useMutation({
    mutationFn: async (nextName: string) => {
      const result = await authClient.updateUser({ name: nextName });
      if (result.error)
        throw new Error(result.error.message || "Couldn't update profile");
      return result;
    },
    onSuccess: async () => {
      toast.success("Profile updated");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["auth", "session"] }),
        qc.invalidateQueries({ queryKey: ["profile", "summary"] }),
      ]);
    },
    onError: (error) =>
      toast.error("Couldn't update profile", {
        description: error instanceof Error ? error.message : String(error),
      }),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });
      if (result.error)
        throw new Error(result.error.message || "Couldn't change password");
      return result;
    },
    onSuccess: async () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["auth", "sessions"] }),
        qc.invalidateQueries({ queryKey: ["auth", "session-detail"] }),
        qc.invalidateQueries({ queryKey: ["profile", "summary"] }),
      ]);
    },
    onError: (error) =>
      toast.error("Couldn't change password", {
        description: error instanceof Error ? error.message : String(error),
      }),
  });

  const revokeSession = useMutation({
    mutationFn: async (token: string) => {
      const r = await fetch("/api/auth/revoke-session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? "Couldn't revoke session");
      }
    },
    onSuccess: async () => {
      toast.success("Session revoked");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["auth", "sessions"] }),
        qc.invalidateQueries({ queryKey: ["profile", "summary"] }),
      ]);
    },
    onError: (error) =>
      toast.error("Couldn't revoke session", {
        description: error instanceof Error ? error.message : String(error),
      }),
  });

  const revokeOther = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/auth/revoke-sessions", {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? "Couldn't sign out other devices");
      }
    },
    onSuccess: async () => {
      toast.success("Signed out other sessions");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["auth", "sessions"] }),
        qc.invalidateQueries({ queryKey: ["profile", "summary"] }),
      ]);
    },
    onError: (error) =>
      toast.error("Couldn't sign out other sessions", {
        description: error instanceof Error ? error.message : String(error),
      }),
  });

  const profileName = name || summary.data?.user.name || me.data?.name || "";
  const passwordMismatch =
    confirmPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword !== newPassword;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Profile"
        description="Manage your account details, password, and active sign-in sessions."
      />

      {summary.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : summary.data ? (
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Active sign-ins" value={summary.data.stats.authSessionCount} />
          <StatCard
            label="Conversations started"
            value={summary.data.stats.conversationCount}
          />
          <StatCard label="Agent runs" value={summary.data.stats.runCount} />
          <StatCard
            label="Agents available"
            value={summary.data.stats.accessibleAgentCount}
          />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCircleIcon weight="duotone" />
              Account details
            </CardTitle>
            <CardDescription>
              Update the name shown around the workspace and review recent activity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <ReadOnlyField
                  label="Email"
                  value={summary.data?.user.email ?? me.data?.email ?? "—"}
                />
                <ReadOnlyField
                  label="Role"
                  value={summary.data?.user.role ?? me.data?.role ?? "member"}
                  asBadge
                />
                <ReadOnlyField
                  label="Joined"
                  value={formatDateTime(summary.data?.user.createdAt)}
                />
                <ReadOnlyField
                  label="Last conversation"
                  value={formatDateTime(summary.data?.activity.lastConversationAt)}
                />
                <ReadOnlyField
                  label="Last run"
                  value={formatDateTime(summary.data?.activity.lastRunAt)}
                />
                <ReadOnlyField
                  label="Current session refreshed"
                  value={formatDateTime(currentSession.data?.session.updatedAt ?? null)}
                />
              </div>

              <Separator />

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  updateProfile.mutate(profileName.trim());
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="profile-name">Display name</FieldLabel>
                    <Input
                      id="profile-name"
                      value={profileName}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="How your teammates should see you"
                    />
                  </Field>
                  <Button
                    type="submit"
                    disabled={updateProfile.isPending || profileName.trim().length === 0}
                    className="w-fit"
                  >
                    {updateProfile.isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <UserCircleIcon data-icon="inline-start" />
                    )}
                    Save profile
                  </Button>
                </FieldGroup>
              </form>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LockKeyIcon weight="duotone" />
              Password
            </CardTitle>
            <CardDescription>
              Change your password and optionally sign out your other devices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (newPassword !== confirmPassword) {
                  toast.error("Passwords do not match");
                  return;
                }
                changePassword.mutate();
              }}
            >
              <FieldGroup>
                <FieldSet>
                  <Field>
                    <FieldLabel htmlFor="current-password">Current password</FieldLabel>
                    <Input
                      id="current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-password">New password</FieldLabel>
                    <Input
                      id="new-password"
                      type="password"
                      minLength={8}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                  </Field>
                  <Field data-invalid={passwordMismatch || undefined}>
                    <FieldLabel htmlFor="confirm-password">
                      Confirm new password
                    </FieldLabel>
                    <Input
                      id="confirm-password"
                      type="password"
                      minLength={8}
                      aria-invalid={passwordMismatch || undefined}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                    <FieldDescription>
                      Use at least 8 characters. Reusing your current password is
                      discouraged.
                    </FieldDescription>
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="revoke-other-sessions"
                      checked={revokeOtherSessions}
                      onCheckedChange={(checked) =>
                        setRevokeOtherSessions(checked === true)
                      }
                    />
                    <FieldContent>
                      <FieldLabel htmlFor="revoke-other-sessions">
                        Sign out other sessions after changing password
                      </FieldLabel>
                      <FieldDescription>
                        Keep this enabled on shared or previously used devices.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldSet>
                <Button
                  type="submit"
                  disabled={
                    changePassword.isPending ||
                    !currentPassword ||
                    !newPassword ||
                    !confirmPassword ||
                    passwordMismatch
                  }
                  className="w-fit"
                >
                  {changePassword.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <LockKeyIcon data-icon="inline-start" />
                  )}
                  Update password
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SunIcon weight="duotone" />
            Appearance
          </CardTitle>
          <CardDescription>
            Choose how the interface looks on this device. Your preference is saved
            locally.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="theme-select">Color theme</FieldLabel>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger id="theme-select" className="w-48">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="system">System default</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                System default follows your operating system's color scheme preference.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DesktopIcon weight="duotone" />
            Active sessions
          </CardTitle>
          <CardDescription>
            Review where you are signed in and revoke sessions you no longer trust.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={revokeOther.isPending || sortedSessions.length <= 1}
                onClick={() => revokeOther.mutate()}
              >
                {revokeOther.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <SignOutIcon data-icon="inline-start" />
                )}
                Sign out other sessions
              </Button>
            </div>

            {sessions.isLoading ? (
              <Skeleton className="h-36 w-full" />
            ) : (
              <div className="flex flex-col divide-y border">
                {sortedSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    isCurrent={session.id === currentSessionId}
                    isPending={revokeSession.isPending}
                    onRevoke={() => revokeSession.mutate(session.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function ReadOnlyField({
  label,
  value,
  asBadge = false,
}: {
  label: string;
  value: string;
  asBadge?: boolean;
}) {
  return (
    <Field>
      <FieldTitle>{label}</FieldTitle>
      {asBadge ? (
        <Badge variant="secondary" className="w-fit capitalize">
          {value}
        </Badge>
      ) : (
        <div className="text-sm">{value}</div>
      )}
    </Field>
  );
}

function SessionRow({
  session,
  isCurrent,
  isPending,
  onRevoke,
}: {
  session: AuthSessionInfo;
  isCurrent: boolean;
  isPending: boolean;
  onRevoke: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{summariseUserAgent(session.userAgent)}</span>
          {isCurrent ? <Badge>Current</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ClockIcon />
            Last active {formatDateTime(session.updatedAt)}
          </span>
          <span className="inline-flex items-center gap-1">
            <ClockCounterClockwiseIcon />
            Expires {formatDateTime(session.expiresAt)}
          </span>
          <span>{session.ipAddress || "IP unavailable"}</span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={isPending || isCurrent}
        onClick={onRevoke}
      >
        {isPending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <SignOutIcon data-icon="inline-start" />
        )}
        Revoke
      </Button>
    </div>
  );
}

function summariseUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const compact = userAgent.replace(/\s+/g, " ").trim();
  if (compact.length <= 80) return compact;
  return `${compact.slice(0, 77)}…`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
