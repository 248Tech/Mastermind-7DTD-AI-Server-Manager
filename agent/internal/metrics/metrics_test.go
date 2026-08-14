package metrics

import "testing"

func TestCountersAndGaugesAreObservable(t *testing.T) {
	before := Current()
	ReadQueued(1)
	ReadActive(1)
	MutationQueued(1)
	JobCompleted()
	JobFailed()
	HeartbeatFailed()
	PollFailed()
	LogUploaded(42)
	LogUploadFailed()
	SetLogBacklog(7)
	after := Current()

	if after.ReadQueued != before.ReadQueued+1 || after.ReadActive != before.ReadActive+1 || after.MutationQueued != before.MutationQueued+1 {
		t.Fatal("concurrency gauges did not update")
	}
	if after.JobsCompleted != before.JobsCompleted+1 || after.JobsFailed != before.JobsFailed+1 {
		t.Fatal("job counters did not update")
	}
	if after.HeartbeatFailures != before.HeartbeatFailures+1 || after.PollFailures != before.PollFailures+1 {
		t.Fatal("network failure counters did not update")
	}
	if after.LogUploadBytes != before.LogUploadBytes+42 || after.LogUploadFailures != before.LogUploadFailures+1 || after.LogBacklogBytes != 7 {
		t.Fatal("log delivery metrics did not update")
	}

	ReadQueued(-1)
	ReadActive(-1)
	MutationQueued(-1)
	SetLogBacklog(0)
}
