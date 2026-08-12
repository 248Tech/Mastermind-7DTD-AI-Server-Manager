package agent

import "context"

type progressReporterKey struct{}

type ProgressReporter func(phase, message string)

func WithProgressReporter(ctx context.Context, reporter ProgressReporter) context.Context {
	return context.WithValue(ctx, progressReporterKey{}, reporter)
}

func ReportProgress(ctx context.Context, phase, message string) {
	if reporter, ok := ctx.Value(progressReporterKey{}).(ProgressReporter); ok && reporter != nil {
		reporter(phase, message)
	}
}
