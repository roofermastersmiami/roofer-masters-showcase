import { Component, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Keep measurements and unsaved form state mounted when the optional renderer fails.
export class DrawingErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <h3 className="font-semibold text-foreground">Drawing unavailable</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your measurements are still here. Save any edits before reloading the page.
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RefreshCw /> Reload page
        </Button>
      </div>
    );
  }
}
