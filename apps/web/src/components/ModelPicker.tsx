import { useMemo, useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import type { ReasoningLevel } from "@open-agents/types";
import { useModelCatalog } from "@/lib/queries";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

export type ModelSelection = {
  modelProvider: string;
  modelId: string;
  reasoningLevel: ReasoningLevel;
};

const REASONING_LEVEL_LABELS: Record<ReasoningLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
};

function preferredReasoningLevel(
  supported: ReasoningLevel[],
  current: ReasoningLevel,
): ReasoningLevel {
  if (supported.includes(current)) return current;
  if (supported.includes("high")) return "high";
  return supported.find((level) => level !== "off") ?? "off";
}

type Props = {
  value: ModelSelection;
  onChange: (next: ModelSelection) => void;
};

export function ModelPicker({ value, onChange }: Props) {
  const catalog = useModelCatalog();
  const [query, setQuery] = useState("");

  const activeProvider = catalog.data?.providers.find(
    (p) => p.id === value.modelProvider,
  );
  const filteredModels = useMemo(() => {
    if (!activeProvider) return [];
    const q = query.trim().toLowerCase();
    if (!q) return activeProvider.models;
    return activeProvider.models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [activeProvider, query]);

  if (catalog.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full sm:w-72" />
        <Skeleton className="h-10 w-full sm:w-96" />
      </div>
    );
  }

  if (catalog.isError || !catalog.data) {
    return (
      <p className="text-sm text-destructive">
        Could not load the model catalog. Check that the API is running.
      </p>
    );
  }

  const catalogData = catalog.data;
  const selectableProviders = catalogData.providers.filter((p) => p.credentialSupported);
  const activeModel = activeProvider?.models.find((m) => m.id === value.modelId);

  const credentialReady = activeProvider?.credentialSupported
    ? activeProvider.configured
    : true;

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="model-provider">Provider</FieldLabel>
        <Select
          value={value.modelProvider}
          onValueChange={(modelProvider) => {
            const nextProvider = catalogData.providers.find(
              (p) => p.id === modelProvider,
            );
            const firstModel = nextProvider?.models[0];
            onChange({
              modelProvider,
              modelId: firstModel?.id ?? "",
              reasoningLevel: preferredReasoningLevel(
                firstModel?.supportedReasoningLevels ?? ["off"],
                value.reasoningLevel,
              ),
            });
            setQuery("");
          }}
        >
          <SelectTrigger id="model-provider" className="w-full sm:w-72">
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            {selectableProviders.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-2">
                  {p.label}
                  {p.credentialSupported && !p.configured ? (
                    <Badge variant="outline" className="text-xs">
                      key missing
                    </Badge>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          Models come from the Pi catalog. Configure API keys under Settings → Service
          secrets.
        </FieldDescription>
      </Field>

      {activeProvider && !activeProvider.credentialSupported ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="duotone" />
          This provider is listed for discovery but cannot be used until a service secret
          mapping is added for it.
        </p>
      ) : null}

      {activeProvider?.credentialSupported && !activeProvider.configured ? (
        <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
          <WarningCircleIcon className="mt-0.5 size-4 shrink-0" weight="duotone" />
          Add the {activeProvider.label} API key in Settings before running this agent.
        </p>
      ) : null}

      <Field>
        <FieldLabel htmlFor="model-id">Model</FieldLabel>
        <Input
          id="model-search"
          className="mb-2 w-full sm:w-96"
          placeholder="Filter models…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!activeProvider}
        />
        <Select
          value={value.modelId}
          onValueChange={(modelId) => {
            const nextModel = activeProvider?.models.find(
              (model) => model.id === modelId,
            );
            onChange({
              ...value,
              modelId,
              reasoningLevel: preferredReasoningLevel(
                nextModel?.supportedReasoningLevels ?? ["off"],
                value.reasoningLevel,
              ),
            });
          }}
          disabled={!activeProvider || filteredModels.length === 0}
        >
          <SelectTrigger id="model-id" className="w-full sm:w-96">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {filteredModels.length === 0 ? (
              <SelectGroup>
                <SelectLabel>No models match</SelectLabel>
              </SelectGroup>
            ) : (
              <SelectGroup>
                {filteredModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="flex flex-col items-start gap-0.5">
                      <span>{m.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {m.id}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        {activeModel ? (
          <FieldDescription>
            {activeModel.contextWindow.toLocaleString()} token context · up to{" "}
            {activeModel.maxTokens.toLocaleString()} output tokens
            {activeModel.reasoning ? " · reasoning capable" : ""}
            {credentialReady ? "" : " · API key required"}
          </FieldDescription>
        ) : (
          <FieldDescription>Choose a model from the catalog.</FieldDescription>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="reasoning-level">Reasoning effort</FieldLabel>
        <Select
          value={preferredReasoningLevel(
            activeModel?.supportedReasoningLevels ?? ["off"],
            value.reasoningLevel,
          )}
          onValueChange={(reasoningLevel) =>
            onChange({ ...value, reasoningLevel: reasoningLevel as ReasoningLevel })
          }
          disabled={!activeModel?.reasoning}
        >
          <SelectTrigger id="reasoning-level" className="w-full sm:w-72">
            <SelectValue placeholder="Select reasoning effort" />
          </SelectTrigger>
          <SelectContent>
            {(activeModel?.supportedReasoningLevels ?? ["off"]).map((level) => (
              <SelectItem key={level} value={level}>
                {REASONING_LEVEL_LABELS[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          {activeModel?.reasoning
            ? "Higher effort can improve difficult tasks but increases latency and token usage."
            : "This model does not support configurable reasoning."}
        </FieldDescription>
      </Field>
    </div>
  );
}
