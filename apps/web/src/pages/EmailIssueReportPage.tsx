import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircleIcon,
  WarningCircleIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { FallbackLogo } from "@/components/FallbackLogo";
import { ApiError, api } from "@/lib/api";
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
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type EmailReportContext = {
  agentDisplayName: string;
  subject: string;
  reporterEmail: string;
};

export default function EmailIssueReportPage({ productName }: { productName: string }) {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const submitted = params.get("success") === "1";
  const [filed, setFiled] = useState(submitted);
  const [description, setDescription] = useState("");
  const done = filed || submitted;

  const context = useQuery({
    queryKey: ["email-issue-report", token],
    enabled: Boolean(token) && !done,
    queryFn: () =>
      api<EmailReportContext>(
        `/api/issues/email-report?token=${encodeURIComponent(token)}`,
      ),
    retry: false,
  });

  const submit = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/issues/email-report", {
        json: { token, description: description.trim() },
      }),
    onSuccess: () => setFiled(true),
  });
  const invalid = !token && !done;
  const loading = Boolean(token) && !done && context.isLoading;
  const unavailable = Boolean(token) && !done && !context.isLoading && context.isError;

  const title = useMemo(() => {
    if (done) return "Thanks for reporting";
    if (invalid || unavailable) return "Report not available";
    return `Report a problem with ${context.data?.agentDisplayName ?? "this agent"}`;
  }, [done, invalid, unavailable, context.data?.agentDisplayName]);

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center text-foreground">
            {done ? (
              <CheckCircleIcon className="size-4" weight="fill" />
            ) : (
              <FallbackLogo className="size-6" />
            )}
          </div>
          <CardTitle>{title}</CardTitle>
          {done ? (
            <CardDescription>
              Your report has been filed. The team can now review the conversation and
              follow up. You can close this tab.
            </CardDescription>
          ) : invalid || unavailable ? (
            <CardDescription>
              This report link is invalid or has expired. If the agent&apos;s behaviour is
              still an issue, reply to the email thread and a member of the team will
              follow up.
            </CardDescription>
          ) : (
            <CardDescription>
              Thread:{" "}
              <span className="font-medium text-foreground">{context.data?.subject}</span>
              . Your message and the full conversation will be visible to the{" "}
              {productName} admins so they can investigate.
            </CardDescription>
          )}
        </CardHeader>

        {loading ? (
          <CardContent className="flex justify-center py-8">
            <Spinner className="size-6 text-muted-foreground" />
          </CardContent>
        ) : null}

        {done ? null : invalid || unavailable ? (
          <CardContent>
            <Empty className="border-0 p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WarningOctagonIcon />
                </EmptyMedia>
                <EmptyTitle>Link unavailable</EmptyTitle>
                <EmptyDescription>
                  {invalid
                    ? "Open the report link from your agent email again."
                    : context.error instanceof ApiError
                      ? context.error.message
                      : "This report link is invalid or has expired."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        ) : context.data ? (
          <>
            <CardContent>
              <form
                id="email-issue-report-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!description.trim()) return;
                  submit.mutate();
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="reporter-email">Your email</FieldLabel>
                    <Input
                      id="reporter-email"
                      type="email"
                      value={context.data.reporterEmail}
                      disabled
                      readOnly
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="issue-description">What went wrong?</FieldLabel>
                    <Textarea
                      id="issue-description"
                      rows={5}
                      required
                      maxLength={4000}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Describe what the agent did wrong, what you expected instead, and any other context that would help us fix it."
                    />
                    <FieldDescription>
                      {description.trim().length} / 4000 characters
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
            <CardFooter className="gap-2">
              <Button
                form="email-issue-report-form"
                type="submit"
                disabled={submit.isPending || !description.trim()}
                className="w-full sm:w-auto"
              >
                {submit.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <WarningCircleIcon data-icon="inline-start" />
                )}
                {submit.isPending ? "Submitting…" : "Submit report"}
              </Button>
            </CardFooter>
            {submit.isError ? (
              <CardContent className="pt-0">
                <Empty className="border border-destructive/30 bg-destructive/5">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <WarningOctagonIcon className="text-destructive" />
                    </EmptyMedia>
                    <EmptyTitle>Couldn&apos;t file report</EmptyTitle>
                    <EmptyDescription>
                      {submit.error instanceof ApiError
                        ? submit.error.message
                        : String(submit.error)}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent />
                </Empty>
              </CardContent>
            ) : null}
          </>
        ) : null}
      </Card>
    </div>
  );
}
