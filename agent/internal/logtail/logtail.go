package logtail

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/mastermind/agent/internal/backoff"
	"github.com/mastermind/agent/internal/metrics"
)

const (
	maxChunkSize = 64 * 1024
	initialTail  = 64 * 1024
	batchLatency = 350 * time.Millisecond
	defaultPoll  = time.Second
)

// Streamer is the subset of the control-plane client used by the log tailer.
// HTTPClient implements this directly, avoiding a reader/read-all copy.
type Streamer interface {
	StreamLogBytes(ctx context.Context, hostID, serverInstanceID string, content []byte) error
}

// Run follows path until ctx is cancelled. It keeps the active file open, batches
// small writes for a short period, and never discards a batch that failed upload.
func Run(ctx context.Context, cl Streamer, hostID, serverInstanceID, path string, interval time.Duration) {
	if interval <= 0 {
		interval = defaultPoll
	}
	t := newTailer(cl, hostID, serverInstanceID, path)
	defer t.close()
	retry := backoff.New(backoff.Config{})

	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-timer.C:
			if err := t.step(ctx, now); err != nil && !errors.Is(err, context.Canceled) {
				slog.Warn("server log tail failed", "path", path, "err", err)
				if err := retry.Wait(ctx); err != nil {
					return
				}
				timer.Reset(0)
				continue
			}
			retry.Reset()
			delay := interval
			if len(t.pending) > 0 {
				if remaining := t.flushAfter(now); remaining < delay {
					delay = remaining
				}
			}
			if delay < 0 {
				delay = 0
			}
			timer.Reset(delay)
		}
	}
}

type tailer struct {
	streamer         Streamer
	hostID           string
	serverInstanceID string
	path             string

	file        *os.File
	fileInfo    os.FileInfo
	initialized bool
	readOffset  int64
	ackedOffset int64

	pending      []byte
	pendingSince time.Time
	resetPending bool
	replaced     bool
	missing      bool
}

func newTailer(cl Streamer, hostID, serverInstanceID, path string) *tailer {
	return &tailer{
		streamer: cl, hostID: hostID, serverInstanceID: serverInstanceID, path: path,
		pending: make([]byte, 0, maxChunkSize),
	}
}

func (t *tailer) close() {
	if t.file != nil {
		_ = t.file.Close()
		t.file = nil
	}
}

func (t *tailer) step(ctx context.Context, now time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if t.file == nil {
		if err := t.open(); err != nil {
			return err
		}
	}

	if err := t.observePath(); err != nil {
		return err
	}
	if t.resetPending && len(t.pending) == 0 {
		if err := t.reset(); err != nil {
			return err
		}
	}

	if len(t.pending) < maxChunkSize && !t.resetPending {
		n, err := t.file.Read(t.pending[len(t.pending):cap(t.pending)])
		if n > 0 {
			if len(t.pending) == 0 {
				t.pendingSince = now
			}
			t.pending = t.pending[:len(t.pending)+n]
			t.readOffset += int64(n)
			metrics.SetLogBacklog(len(t.pending))
		}
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		if errors.Is(err, io.EOF) && (t.replaced || t.missing) && len(t.pending) > 0 {
			// Finish the old file promptly before following a replacement.
			t.pendingSince = now.Add(-batchLatency)
		}
	}

	if len(t.pending) == maxChunkSize || t.batchDue(now) {
		if err := t.flush(ctx); err != nil {
			return err
		}
	}

	if len(t.pending) == 0 && t.replaced {
		return t.switchToReplacement()
	}
	return nil
}

func (t *tailer) open() error {
	f, err := os.Open(t.path)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return err
	}
	start := int64(0)
	if !t.initialized && info.Size() > initialTail {
		start = info.Size() - initialTail
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		_ = f.Close()
		return err
	}
	t.file, t.fileInfo, t.initialized = f, info, true
	t.readOffset, t.ackedOffset = start, start
	t.replaced, t.missing, t.resetPending = false, false, false
	return nil
}

func (t *tailer) observePath() error {
	openInfo, err := t.file.Stat()
	if err != nil {
		return err
	}
	if openInfo.Size() < t.readOffset {
		t.resetPending = true
	}

	pathInfo, err := os.Stat(t.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			t.missing = true
			return nil
		}
		return err
	}
	t.missing = false
	t.replaced = !os.SameFile(openInfo, pathInfo)
	return nil
}

func (t *tailer) reset() error {
	if _, err := t.file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	t.readOffset, t.ackedOffset = 0, 0
	t.resetPending = false
	return nil
}

func (t *tailer) switchToReplacement() error {
	f, err := os.Open(t.path)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return err
	}
	old := t.file
	t.file, t.fileInfo = f, info
	t.readOffset, t.ackedOffset = 0, 0
	t.replaced, t.missing, t.resetPending = false, false, false
	return old.Close()
}

func (t *tailer) batchDue(now time.Time) bool {
	return len(t.pending) > 0 && !now.Before(t.pendingSince.Add(batchLatency))
}

func (t *tailer) flushAfter(now time.Time) time.Duration {
	return t.pendingSince.Add(batchLatency).Sub(now)
}

func (t *tailer) flush(ctx context.Context) error {
	if len(t.pending) == 0 {
		return nil
	}
	if err := t.streamer.StreamLogBytes(ctx, t.hostID, t.serverInstanceID, t.pending); err != nil {
		metrics.LogUploadFailed()
		return err
	}
	metrics.LogUploaded(len(t.pending))
	t.ackedOffset += int64(len(t.pending))
	t.pending = t.pending[:0]
	metrics.SetLogBacklog(0)
	t.pendingSince = time.Time{}
	return nil
}
