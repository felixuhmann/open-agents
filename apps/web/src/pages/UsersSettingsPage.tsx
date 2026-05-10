import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlusIcon, ShieldCheckIcon, TrashIcon, UsersIcon } from "@phosphor-icons/react";
import { ApiError, api } from "@/lib/api";
import { useCurrentUser, useUsers } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function UsersSettingsPage() {
  const users = useUsers();
  const me = useCurrentUser();
  const qc = useQueryClient();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");

  const create = useMutation({
    mutationFn: () =>
      api("/api/users", {
        method: "POST",
        json: { email, name: name || undefined, password, role },
      }),
    onSuccess: async () => {
      setEmail("");
      setName("");
      setPassword("");
      setRole("member");
      toast.success("User created");
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) =>
      toast.error("Couldn't create user", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "admin" | "member" }) =>
      api(`/api/users/${id}`, { method: "PATCH", json: { role } }),
    onSuccess: async () => {
      toast.success("Role updated");
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) =>
      toast.error("Couldn't update role", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("User deleted");
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) =>
      toast.error("Couldn't delete", {
        description: e instanceof ApiError ? e.message : String(e),
      }),
  });

  const isEmpty = !users.isLoading && (users.data?.length ?? 0) === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="Admins create accounts directly here. There is no public sign-up."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlusIcon className="size-4" weight="duotone" />
            Create user
          </CardTitle>
          <CardDescription>
            Provision a new account with the chosen role and starting password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="create-user"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <FieldGroup>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="user-email">Email</FieldLabel>
                  <Input
                    id="user-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="user-name">
                    Name
                    <span className="text-muted-foreground">(optional)</span>
                  </FieldLabel>
                  <Input
                    id="user-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="user-password">Initial password</FieldLabel>
                  <Input
                    id="user-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <FieldDescription>
                    Share securely; the user can change it after first sign-in.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="user-role">Role</FieldLabel>
                  <Select
                    value={role}
                    onValueChange={(v) => setRole(v as "admin" | "member")}
                  >
                    <SelectTrigger id="user-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Admins manage the deployment, secrets, and other users.
                  </FieldDescription>
                </Field>
              </div>
              <Button
                form="create-user"
                type="submit"
                disabled={create.isPending}
                className="w-fit"
              >
                {create.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlusIcon data-icon="inline-start" />
                )}
                {create.isPending ? "Creating…" : "Create user"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {users.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : isEmpty ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>No users yet</EmptyTitle>
            <EmptyDescription>
              Create the first member or admin above to get started.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-[1%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data?.map((u) => {
                const isMe = u.id === me.data?.id;
                const initials = (u.name ?? u.email).slice(0, 2).toUpperCase();
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-7 rounded-none">
                          <AvatarFallback className="rounded-none bg-muted text-foreground text-[10px]">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-col">
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            <span className="truncate">{u.email}</span>
                            {isMe ? (
                              <Badge variant="outline" className="text-xs">
                                you
                              </Badge>
                            ) : null}
                          </div>
                          {u.name ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {u.name}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        disabled={isMe}
                        onValueChange={(v) =>
                          updateRole.mutate({
                            id: u.id,
                            role: v as "admin" | "member",
                          })
                        }
                      >
                        <SelectTrigger size="sm" className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="member">member</SelectItem>
                            <SelectItem value="admin">
                              <ShieldCheckIcon data-icon="inline-start" />
                              admin
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      {isMe ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Delete ${u.email}`}
                            >
                              <TrashIcon />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {u.email}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Their account will be removed immediately. Any
                                conversations they own remain in the database.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove.mutate(u.id)}>
                                Delete user
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
