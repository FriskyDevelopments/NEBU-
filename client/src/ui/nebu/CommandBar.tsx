import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { XiGlyph } from "@/ui/stix/XiGlyph";

export function CommandBar({
  value,
  onChange,
  onSubmit,
  onQuickCommand,
  isExecuting,
  helperText,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onQuickCommand: (command: string) => void;
  isExecuting: boolean;
  helperText: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Command Parser</h2>
        <XiGlyph state={isExecuting ? "signal" : "base"} label={isExecuting ? "executing" : "standby"} />
      </div>
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        if (!isExecuting && value.trim()) onSubmit();
      }}>
        <Input
          aria-label="Command"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Try /zoom mute all"
          className="font-mono"
        />
        <Button type="submit" disabled={isExecuting || !value.trim()}>
          {isExecuting ? "Running…" : "Run"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">{helperText}</p>
      <div className="flex flex-wrap gap-2">
        {["/zoom admit all", "/zoom mute all", "/zoom lock room", "/capture moment"].map((quick) => (
          <Button key={quick} variant="outline" size="sm" disabled={isExecuting} onClick={() => onQuickCommand(quick)}>
            {quick}
          </Button>
        ))}
      </div>
    </div>
  );
}
