import { EmptyState } from "@riddlr/ui";
import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { message?: string }> {
  override state: { message?: string } = {};

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    if (this.state.message) {
      return <EmptyState asPageTitle title="Something went wrong" body={this.state.message} />;
    }
    return this.props.children;
  }
}
