// Package metrics holds lightweight process-local operational counters. The
// agent exposes these through periodic debug logs without adding a network
// listener or changing the control-plane API.
package metrics

import (
	"runtime"
	"sync/atomic"
)

var state struct {
	readActive        atomic.Int64
	readQueued        atomic.Int64
	mutationQueued    atomic.Int64
	jobsCompleted     atomic.Uint64
	jobsFailed        atomic.Uint64
	heartbeatFailures atomic.Uint64
	pollFailures      atomic.Uint64
	logUploadBytes    atomic.Uint64
	logUploadFailures atomic.Uint64
	logBacklogBytes   atomic.Int64
}

type Snapshot struct {
	Goroutines        int
	ReadActive        int64
	ReadQueued        int64
	MutationQueued    int64
	JobsCompleted     uint64
	JobsFailed        uint64
	HeartbeatFailures uint64
	PollFailures      uint64
	LogUploadBytes    uint64
	LogUploadFailures uint64
	LogBacklogBytes   int64
}

func ReadQueued(delta int64)     { state.readQueued.Add(delta) }
func ReadActive(delta int64)     { state.readActive.Add(delta) }
func MutationQueued(delta int64) { state.mutationQueued.Add(delta) }
func JobCompleted()              { state.jobsCompleted.Add(1) }
func JobFailed()                 { state.jobsFailed.Add(1) }
func HeartbeatFailed()           { state.heartbeatFailures.Add(1) }
func PollFailed()                { state.pollFailures.Add(1) }
func LogUploaded(bytes int)      { state.logUploadBytes.Add(uint64(bytes)) }
func LogUploadFailed()           { state.logUploadFailures.Add(1) }
func SetLogBacklog(bytes int)    { state.logBacklogBytes.Store(int64(bytes)) }

func Current() Snapshot {
	return Snapshot{
		Goroutines:        runtime.NumGoroutine(),
		ReadActive:        state.readActive.Load(),
		ReadQueued:        state.readQueued.Load(),
		MutationQueued:    state.mutationQueued.Load(),
		JobsCompleted:     state.jobsCompleted.Load(),
		JobsFailed:        state.jobsFailed.Load(),
		HeartbeatFailures: state.heartbeatFailures.Load(),
		PollFailures:      state.pollFailures.Load(),
		LogUploadBytes:    state.logUploadBytes.Load(),
		LogUploadFailures: state.logUploadFailures.Load(),
		LogBacklogBytes:   state.logBacklogBytes.Load(),
	}
}
