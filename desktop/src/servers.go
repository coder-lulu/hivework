package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"unicode"
)

var (
	ErrInvalidServerURL   = errors.New("invalid server URL")
	ErrDuplicateServerURL = errors.New("duplicate server URL")
	ErrUnknownServerURL   = errors.New("active server URL is not saved")
	ErrServerConfigLoad   = errors.New("cannot load server configuration")
)

type ServerProfile struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type ServerConfig struct {
	Servers   []ServerProfile `json:"servers"`
	ActiveURL *string         `json:"activeUrl"`
}

type serverStore struct {
	mu      sync.Mutex
	path    string
	cur     ServerConfig
	loadErr error
}

func normalizeServerURL(raw string) (string, error) {
	if strings.ContainsFunc(raw, unicode.IsControl) {
		return "", ErrInvalidServerURL
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ErrInvalidServerURL
	}
	if !strings.Contains(raw, "://") {
		host := raw
		if strings.Contains(raw, ":") {
			var err error
			host, _, err = net.SplitHostPort(raw)
			if err != nil {
				return "", ErrInvalidServerURL
			}
		}
		scheme := "https://"
		if strings.EqualFold(host, "localhost") || (net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()) {
			scheme = "http://"
		}
		raw = scheme + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.Opaque != "" || u.RawQuery != "" || u.ForceQuery || strings.Contains(raw, "#") || (u.Path != "" && u.Path != "/") || u.RawPath != "" {
		return "", ErrInvalidServerURL
	}
	u.Scheme = strings.ToLower(u.Scheme)
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", ErrInvalidServerURL
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return "", ErrInvalidServerURL
	}
	if net.ParseIP(host) == nil {
		if strings.ContainsAny(host, ":[]") {
			return "", ErrInvalidServerURL
		}
		for _, label := range strings.Split(strings.TrimSuffix(host, "."), ".") {
			if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") || strings.ContainsFunc(label, func(r rune) bool {
				return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-'
			}) {
				return "", ErrInvalidServerURL
			}
		}
	}
	port := u.Port()
	if strings.HasSuffix(u.Host, ":") {
		return "", ErrInvalidServerURL
	}
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", ErrInvalidServerURL
		}
		port = strconv.Itoa(n)
		if (u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443") {
			port = ""
		}
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		host += ":" + port
	}
	return u.Scheme + "://" + host, nil
}

func validatedServerConfig(next ServerConfig) (ServerConfig, error) {
	out := ServerConfig{Servers: make([]ServerProfile, 0, len(next.Servers))}
	seen := make(map[string]bool, len(next.Servers))
	for _, server := range next.Servers {
		normalized, err := normalizeServerURL(server.URL)
		if err != nil {
			return ServerConfig{}, err
		}
		if seen[normalized] {
			return ServerConfig{}, ErrDuplicateServerURL
		}
		seen[normalized] = true
		name := strings.TrimSpace(server.Name)
		if name == "" {
			u, _ := url.Parse(normalized)
			name = u.Host
		}
		out.Servers = append(out.Servers, ServerProfile{Name: name, URL: normalized})
	}
	if next.ActiveURL != nil {
		active := *next.ActiveURL
		if active != "" {
			var err error
			active, err = normalizeServerURL(active)
			if err != nil {
				return ServerConfig{}, err
			}
			if !seen[active] {
				return ServerConfig{}, ErrUnknownServerURL
			}
		}
		out.ActiveURL = &active
	}
	return out, nil
}

func newServerStore() *serverStore {
	st := &serverStore{path: filepath.Join(octopHome(), "desktop-servers.json"), cur: ServerConfig{Servers: []ServerProfile{}}}
	data, err := os.ReadFile(st.path)
	if err != nil {
		if !os.IsNotExist(err) {
			st.loadErr = fmt.Errorf("%w: %w", ErrServerConfigLoad, err)
		}
		return st
	}
	var config *ServerConfig
	if err := json.Unmarshal(data, &config); err != nil {
		st.loadErr = fmt.Errorf("%w: %w", ErrServerConfigLoad, err)
		return st
	}
	if config == nil {
		st.loadErr = fmt.Errorf("%w: expected a configuration object", ErrServerConfigLoad)
		return st
	}
	if next, err := validatedServerConfig(*config); err == nil {
		st.cur = next
	} else {
		st.loadErr = fmt.Errorf("%w: %w", ErrServerConfigLoad, err)
	}
	return st
}

func (st *serverStore) loadError() error {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.loadErr
}

func (st *serverStore) get() ServerConfig {
	st.mu.Lock()
	defer st.mu.Unlock()
	out := ServerConfig{Servers: append([]ServerProfile{}, st.cur.Servers...)}
	if st.cur.ActiveURL != nil {
		active := *st.cur.ActiveURL
		out.ActiveURL = &active
	}
	return out
}

func (st *serverStore) save(next ServerConfig) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.loadErr != nil {
		return st.loadErr
	}
	config, err := validatedServerConfig(next)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(st.path), 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(st.path), ".desktop-servers-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(file.Name(), st.path); err != nil {
		return err
	}
	st.cur = config
	return nil
}
