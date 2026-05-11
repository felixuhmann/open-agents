import { WrenchIcon } from "@phosphor-icons/react";
import { useTools } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export default function ToolsLibraryPage() {
  const tools = useTools();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tool catalog"
        description="Every capability that can be attached to an agent."
      />
      {tools.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-36" />
          ))}
        </div>
      ) : !tools.data || tools.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WrenchIcon />
            </EmptyMedia>
            <EmptyTitle>No tools registered</EmptyTitle>
            <EmptyDescription>
              Restart the API so the catalog can populate.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {tools.data.map((t) => (
            <li key={t.id}>
              <Card className="h-full" data-deprecated={t.deprecated || undefined}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <WrenchIcon className="size-4" weight="duotone" />
                    {t.name}
                  </CardTitle>
                  <CardDescription className="font-mono">{t.key}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-xs/relaxed text-foreground">{t.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {t.requiresSecrets ? (
                      <Badge variant="secondary">requires secrets</Badge>
                    ) : null}
                    {t.deprecated ? (
                      <Badge variant="destructive">deprecated</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
