package main

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestNormalizeServerURL(t *testing.T) {
	for input, want := range map[string]string{
		" HTTPS://Work.HiveKernel.COM:443/ ": "https://work.hivekernel.com",
		"work.hivekernel.com":                "https://work.hivekernel.com",
		"http://LOCALHOST:080/":              "http://localhost",
		"localhost:8088":                     "http://localhost:8088",
		"127.0.0.1:8088":                     "http://127.0.0.1:8088",
		"https://192.168.1.20:8443":          "https://192.168.1.20:8443",
		"http://[::1]:8088/":                 "http://[::1]:8088",
		"[::1]:8088":                         "http://[::1]:8088",
		"https://[2001:DB8::1]:443":          "https://[2001:db8::1]",
	} {
		t.Run(input, func(t *testing.T) {
			got, err := normalizeServerURL(input)
			if err != nil || got != want {
				t.Fatalf("normalizeServerURL(%q) = %q, %v; want %q", input, got, err, want)
			}
		})
	}
	for _, input := range []string{
		"", " ", "javascript:alert(1)", "file:///tmp", "ftp://example.com", "https://",
		"https://user:password@example.com", "https://example.com/api", "https://example.com//",
		"https://example.com?", "https://example.com?a=b", "https://example.com#", "https://example.com#x",
		"https://example.com:0", "https://example.com:65536", "https://example.com:abc", "https://example.com:",
		"https://example.com\n", "https://exam ple.com", "https://a..com", "https://-bad.com",
		"https://[invalid]", "https://::1", "https://example.com/%2f", "//example.com", "https://example.com\\evil",
	} {
		t.Run("invalid "+input, func(t *testing.T) {
			if _, err := normalizeServerURL(input); !errors.Is(err, ErrInvalidServerURL) {
				t.Fatalf("normalizeServerURL(%q) error = %v", input, err)
			}
		})
	}
}

func TestServerStorePersistsSelectionAndProfiles(t *testing.T) {
	t.Setenv("OCTOP_HOME", t.TempDir())
	st := newServerStore()
	if err := st.loadError(); err != nil {
		t.Fatalf("missing file produced a load error: %v", err)
	}
	if got := st.get(); got.Servers == nil || len(got.Servers) != 0 || got.ActiveURL != nil {
		t.Fatalf("unexpected defaults: %#v", got)
	}
	active := "HTTPS://WORK.HIVEKERNEL.COM:443/"
	config := ServerConfig{
		Servers:   []ServerProfile{{Name: " Production ", URL: active}, {URL: "localhost:9000"}},
		ActiveURL: &active,
	}
	if err := st.save(config); err != nil {
		t.Fatal(err)
	}
	wantActive := "https://work.hivekernel.com"
	want := ServerConfig{Servers: []ServerProfile{{Name: "Production", URL: wantActive}, {Name: "localhost:9000", URL: "http://localhost:9000"}}, ActiveURL: &wantActive}
	if got := newServerStore().get(); !reflect.DeepEqual(got, want) {
		t.Fatalf("reload = %#v; want %#v", got, want)
	}
	config.Servers[0].Name = "caller mutation"
	active = "caller mutation"
	got := st.get()
	got.Servers[0].URL = "reader mutation"
	*got.ActiveURL = "reader mutation"
	if !reflect.DeepEqual(st.get(), want) {
		t.Fatal("caller or reader mutated shared state")
	}
	for _, selection := range []*string{new(string), nil} {
		next := st.get()
		next.ActiveURL = selection
		if err := st.save(next); err != nil {
			t.Fatal(err)
		}
		if got := newServerStore().get(); !reflect.DeepEqual(got.ActiveURL, selection) || len(got.Servers) != 2 {
			t.Fatalf("local/unselected mode did not persist: %#v", got)
		}
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(st.path)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("settings permissions: %v, %v", info, err)
		}
	}
}

func TestServerStoreRejectsInvalidChanges(t *testing.T) {
	t.Setenv("OCTOP_HOME", t.TempDir())
	st := newServerStore()
	if err := st.save(ServerConfig{Servers: []ServerProfile{{URL: "https://example.com"}}}); err != nil {
		t.Fatal(err)
	}
	want := st.get()
	unknown := "https://other.example.com"
	for _, tc := range []struct {
		config ServerConfig
		err    error
	}{
		{ServerConfig{Servers: []ServerProfile{{URL: "https://example.com"}, {URL: "HTTPS://EXAMPLE.COM:443/"}}}, ErrDuplicateServerURL},
		{ServerConfig{Servers: want.Servers, ActiveURL: &unknown}, ErrUnknownServerURL},
		{ServerConfig{Servers: []ServerProfile{{URL: "file:///tmp"}}}, ErrInvalidServerURL},
	} {
		if err := st.save(tc.config); !errors.Is(err, tc.err) {
			t.Fatalf("save error = %v; want %v", err, tc.err)
		}
		if !reflect.DeepEqual(st.get(), want) || !reflect.DeepEqual(newServerStore().get(), want) {
			t.Fatal("rejected save changed memory or disk")
		}
	}
}

func TestServerStoreDiskFailurePreservesMemory(t *testing.T) {
	t.Setenv("OCTOP_HOME", t.TempDir())
	st := newServerStore()
	if err := st.save(ServerConfig{Servers: []ServerProfile{{URL: "https://example.com"}}}); err != nil {
		t.Fatal(err)
	}
	want := st.get()
	// A directory at the target causes rename to fail on every supported OS.
	if err := os.Remove(st.path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(st.path, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := st.save(ServerConfig{}); err == nil {
		t.Fatal("save unexpectedly succeeded")
	}
	if !reflect.DeepEqual(st.get(), want) {
		t.Fatal("failed save changed memory")
	}
	leftovers, err := filepath.Glob(filepath.Join(filepath.Dir(st.path), ".desktop-servers-*"))
	if err != nil || len(leftovers) != 0 {
		t.Fatalf("temporary files left after failure: %v, %v", leftovers, err)
	}
}

func TestServerStoreInvalidFileRejectsSaveWithoutOverwriting(t *testing.T) {
	t.Setenv("OCTOP_HOME", t.TempDir())
	path := filepath.Join(octopHome(), "desktop-servers.json")
	for _, data := range []string{`{broken`, `null`, `{"servers":[{"url":"file:///tmp"}]}`, `{"servers":[],"activeUrl":"https://missing.example.com"}`} {
		if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
		st := newServerStore()
		if !errors.Is(st.loadError(), ErrServerConfigLoad) {
			t.Fatalf("invalid file load error = %v", st.loadError())
		}
		if got := st.get(); got.Servers == nil || len(got.Servers) != 0 || got.ActiveURL != nil {
			t.Fatalf("invalid file did not fall back: %#v", got)
		}
		if err := st.save(ServerConfig{Servers: []ServerProfile{{URL: "https://example.com"}}}); !errors.Is(err, ErrServerConfigLoad) {
			t.Fatalf("save after failed load error = %v", err)
		}
		if after, err := os.ReadFile(path); err != nil || string(after) != data {
			t.Fatal("loading changed invalid file")
		}
	}
	if err := os.WriteFile(path, []byte(`{"servers":[{"url":"https://example.com"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	restarted := newServerStore()
	if restarted.loadError() != nil || len(restarted.get().Servers) != 1 {
		t.Fatal("repaired file was not loaded on restart")
	}
}

func TestServerStoreReadIOFailureRejectsSave(t *testing.T) {
	t.Setenv("OCTOP_HOME", t.TempDir())
	path := filepath.Join(octopHome(), "desktop-servers.json")
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatal(err)
	}
	st := newServerStore()
	if !errors.Is(st.loadError(), ErrServerConfigLoad) {
		t.Fatalf("directory read error = %v", st.loadError())
	}
	var pathErr *os.PathError
	if !errors.As(st.loadError(), &pathErr) {
		t.Fatal("load error does not preserve underlying I/O failure")
	}
	if err := st.save(ServerConfig{}); !errors.Is(err, ErrServerConfigLoad) {
		t.Fatalf("save after I/O failure error = %v", err)
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		t.Fatal("save modified unreadable configuration path")
	}
}
