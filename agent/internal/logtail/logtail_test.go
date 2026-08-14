package logtail

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

var benchmarkBytes int

type recordingStreamer struct {
	mu       sync.Mutex
	chunks   [][]byte
	failures int
}

func (s *recordingStreamer) StreamLogBytes(_ context.Context, _, _ string, content []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failures > 0 {
		s.failures--
		return errors.New("temporary upload failure")
	}
	s.chunks = append(s.chunks, append([]byte(nil), content...))
	return nil
}

func (s *recordingStreamer) joined() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var b strings.Builder
	for _, chunk := range s.chunks {
		b.Write(chunk)
	}
	return b.String()
}

type testingTB interface {
	Helper()
	Fatal(args ...any)
}

func writeFile(t testingTB, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func appendFile(t *testing.T, path, content string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString(content); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestInitialTailAndBatchLatency(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.log")
	prefix := strings.Repeat("x", 1024)
	want := strings.Repeat("y", initialTail)
	writeFile(t, path, prefix+want)
	s := &recordingStreamer{}
	tailer := newTailer(s, "host", "server", path)
	defer tailer.close()
	now := time.Unix(100, 0)

	if err := tailer.step(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if got := s.joined(); got != want {
		t.Fatalf("initial tail mismatch: got %d bytes, want %d", len(got), len(want))
	}

	appendFile(t, path, "new")
	if err := tailer.step(context.Background(), now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if got := s.joined(); got != want {
		t.Fatalf("small append flushed early: got %d bytes", len(got))
	}
	if err := tailer.step(context.Background(), now.Add(time.Second+batchLatency)); err != nil {
		t.Fatal(err)
	}
	if got := s.joined(); got != want+"new" {
		t.Fatalf("append mismatch: got suffix %q", got[len(want):])
	}
}

func TestFailedUploadRetriedWithoutAdvancingAcknowledgement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.log")
	writeFile(t, path, "retry me")
	s := &recordingStreamer{failures: 1}
	tailer := newTailer(s, "host", "server", path)
	defer tailer.close()
	now := time.Unix(100, 0)

	if err := tailer.step(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	startAck := tailer.ackedOffset
	if err := tailer.step(context.Background(), now.Add(batchLatency)); err == nil {
		t.Fatal("expected upload failure")
	}
	if tailer.ackedOffset != startAck {
		t.Fatalf("acknowledged offset advanced on failure: %d -> %d", startAck, tailer.ackedOffset)
	}
	if string(tailer.pending) != "retry me" {
		t.Fatalf("failed batch not retained: %q", tailer.pending)
	}
	if err := tailer.step(context.Background(), now.Add(2*batchLatency)); err != nil {
		t.Fatal(err)
	}
	if got := s.joined(); got != "retry me" {
		t.Fatalf("retry mismatch: %q", got)
	}
	if tailer.ackedOffset != int64(len("retry me")) {
		t.Fatalf("unexpected acknowledged offset: %d", tailer.ackedOffset)
	}
}

func TestTruncationStartsAtBeginning(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.log")
	writeFile(t, path, "old content")
	s := &recordingStreamer{}
	tailer := newTailer(s, "host", "server", path)
	defer tailer.close()
	now := time.Unix(100, 0)
	if err := tailer.step(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if err := tailer.step(context.Background(), now.Add(batchLatency)); err != nil {
		t.Fatal(err)
	}
	writeFile(t, path, "new")
	if err := tailer.step(context.Background(), now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := tailer.step(context.Background(), now.Add(time.Second+batchLatency)); err != nil {
		t.Fatal(err)
	}
	if got := s.joined(); got != "old contentnew" {
		t.Fatalf("truncation result: %q", got)
	}
}

func TestRotationDrainsOldThenReadsReplacement(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.log")
	rotated := filepath.Join(dir, "server.log.1")
	writeFile(t, path, "old-1")
	s := &recordingStreamer{}
	tailer := newTailer(s, "host", "server", path)
	defer tailer.close()
	now := time.Unix(100, 0)
	if err := tailer.step(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(path, rotated); err != nil {
		t.Fatal(err)
	}
	appendFile(t, rotated, "-old-2")
	writeFile(t, path, "new-file")

	if err := tailer.step(context.Background(), now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := tailer.step(context.Background(), now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := tailer.step(context.Background(), now.Add(2*time.Second+batchLatency)); err != nil {
		t.Fatal(err)
	}
	if got := s.joined(); got != "old-1-old-2new-file" {
		t.Fatalf("rotation result: %q", got)
	}
}

func TestChunksNeverExceedLimitAndAreNotDuplicated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.log")
	want := strings.Repeat("0123456789", 20000)
	writeFile(t, path, "")
	s := &recordingStreamer{}
	tailer := newTailer(s, "host", "server", path)
	defer tailer.close()
	now := time.Unix(100, 0)
	if err := tailer.step(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	appendFile(t, path, want)
	for i := 1; i < 10 && len(s.joined()) < len(want); i++ {
		if err := tailer.step(context.Background(), now.Add(time.Duration(i)*time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	if got := s.joined(); got != want {
		t.Fatalf("delivered content mismatch: got %d bytes", len(got))
	}
	for i, chunk := range s.chunks {
		if len(chunk) > maxChunkSize {
			t.Fatalf("chunk %d is %d bytes", i, len(chunk))
		}
	}
}

func TestStepHonorsCancelledContext(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.log")
	writeFile(t, path, "content")
	tailer := newTailer(&recordingStreamer{}, "host", "server", path)
	defer tailer.close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := tailer.step(ctx, time.Now()); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context cancellation", err)
	}
}

func BenchmarkTailerFullBatch(b *testing.B) {
	path := filepath.Join(b.TempDir(), "server.log")
	writeFile(b, path, strings.Repeat("x", maxChunkSize))
	for i := 0; i < b.N; i++ {
		s := &recordingStreamer{}
		tailer := newTailer(s, "host", "server", path)
		if err := tailer.step(context.Background(), time.Unix(100, 0)); err != nil {
			b.Fatal(err)
		}
		tailer.close()
	}
}

func BenchmarkLogDeliveryCopy(b *testing.B) {
	payload := bytes.Repeat([]byte("x"), maxChunkSize)
	b.Run("legacy_reader_readall", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			copied, err := io.ReadAll(bytes.NewReader(payload))
			if err != nil {
				b.Fatal(err)
			}
			benchmarkBytes = len(copied)
		}
	})
	b.Run("direct_bytes", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			benchmarkBytes = len(payload)
		}
	})
}
