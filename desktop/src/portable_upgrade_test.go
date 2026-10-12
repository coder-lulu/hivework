package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsurePortableRefreshesRebuiltWheel(t *testing.T) {
	for _, test := range []struct {
		name, installedVersion         string
		installedRecord, bundledRecord []string
		wantReplace                    bool
	}{
		{"changed resources", "1.0.2b6", []string{"dashboard,sha256=old,1"}, []string{"dashboard,sha256=new,1"}, true},
		{"identical record", "1.0.2b6", []string{"same"}, []string{"same"}, false},
		{"missing installed record", "1.0.2b6", nil, []string{"new"}, true},
		{"newer installed version", "1.0.2b7", []string{"newer"}, []string{"older"}, false},
		{"legacy bundle without record", "1.0.2b6", []string{"existing"}, nil, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			home := t.TempDir()
			t.Setenv("OCTOP_HOME", home)
			root := portableDir()
			oldZip := filepath.Join(t.TempDir(), "old.zip")
			writeTestGreenZip(t, oldZip, test.installedVersion, test.installedRecord...)
			if err := unzipGreen(oldZip, root); err != nil {
				t.Fatal(err)
			}
			marker := filepath.Join(root, "old-runtime.txt")
			if err := os.WriteFile(marker, []byte("preserve unless replaced"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(home, "octop.db"), []byte("database"), 0o600); err != nil {
				t.Fatal(err)
			}
			newZip := filepath.Join(t.TempDir(), "new.zip")
			writeTestGreenZip(t, newZip, "1.0.2b6", test.bundledRecord...)
			t.Setenv("OCTOP_DESKTOP_PORTABLE_ZIP", newZip)
			backupCalls := 0
			previousBackup := runSQLiteBackup
			runSQLiteBackup = func(_, _, destination string) error {
				backupCalls++
				if _, err := os.Stat(marker); err != nil {
					t.Fatal("runtime replaced before database backup")
				}
				return os.WriteFile(destination, []byte("backup"), 0o600)
			}
			t.Cleanup(func() { runSQLiteBackup = previousBackup })
			for startup := 0; startup < 2; startup++ {
				if err := ensurePortable(LocaleZH, func(string) {}); err != nil {
					t.Fatal(err)
				}
				_, err := os.Stat(marker)
				if os.IsNotExist(err) != test.wantReplace {
					t.Fatalf("replacement = %v, want %v", os.IsNotExist(err), test.wantReplace)
				}
				wantBackups := 0
				if test.wantReplace {
					wantBackups = 1
					record, err := os.ReadFile(filepath.Join(root, "packages", "octop-1.0.2b6.dist-info", "RECORD"))
					if err != nil || string(record) != test.bundledRecord[0] {
						t.Fatalf("installed RECORD = %q, %v", record, err)
					}
				}
				if backupCalls != wantBackups {
					t.Fatalf("startup %d backups = %d, want %d", startup, backupCalls, wantBackups)
				}
				if got := portableVersion(root); got != test.installedVersion {
					t.Fatalf("version = %s, want %s", got, test.installedVersion)
				}
			}
		})
	}
}

func TestPortableVersionPrefersNewestPackageMetadata(t *testing.T) {
	for _, test := range []struct {
		versions       []string
		fromFile, want string
	}{
		{[]string{"0.9.29", "0.9.32"}, "0.9.28", "0.9.32"},
		{[]string{"1.0.2b4", "1.0.2b5"}, "1.0.2b3", "1.0.2b5"},
		{[]string{"1.0.2b9", "1.0.2b10", "1.0.2b4"}, "1.0.2b3", "1.0.2b10"},
	} {
		t.Run(test.want, func(t *testing.T) {
			root := t.TempDir()
			for _, version := range test.versions {
				path := filepath.Join(root, "packages", "octop-"+version+".dist-info", "METADATA")
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte("Version: "+version+"\n"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(root, "VERSION.txt"), []byte("octop_version="+test.fromFile+"\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			if got := portableVersion(root); got != test.want {
				t.Fatalf("portable version = %q, want %q", got, test.want)
			}
		})
	}
}

func TestDesktopSQLitePathUsesConfiguredRelativePath(t *testing.T) {
	home := t.TempDir()
	config := `{"database":{"driver":"sqlite","sqlite_path":"state/control.db"}}`
	if err := os.WriteFile(filepath.Join(home, "config.json"), []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}

	path, isSQLite, err := desktopSQLitePath(home)
	if err != nil {
		t.Fatal(err)
	}
	if !isSQLite {
		t.Fatal("configured SQLite database was not detected")
	}
	want := filepath.Join(home, "state", "control.db")
	if path != want {
		t.Fatalf("SQLite path = %q, want %q", path, want)
	}
}

func TestDesktopSQLitePathSkipsPostgreSQL(t *testing.T) {
	home := t.TempDir()
	config := `{"database":{"driver":"postgresql"}}`
	if err := os.WriteFile(filepath.Join(home, "config.json"), []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}

	path, isSQLite, err := desktopSQLitePath(home)
	if err != nil {
		t.Fatal(err)
	}
	if isSQLite || path != "" {
		t.Fatalf("PostgreSQL resolved as SQLite: path=%q isSQLite=%v", path, isSQLite)
	}
}
