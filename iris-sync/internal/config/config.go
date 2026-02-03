package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Config holds the complete application configuration.
type Config struct {
	Master  MasterConfig  `yaml:"master"`
	Probes  []ProbeConfig `yaml:"probes"`
	Sync    SyncConfig    `yaml:"sync"`
	Logging LogConfig     `yaml:"logging"`
}

// MasterConfig holds MariaDB connection settings for the source of truth.
type MasterConfig struct {
	Host         string `yaml:"host"`
	Port         int    `yaml:"port"`
	Database     string `yaml:"database"`
	Username     string `yaml:"username"`
	Password     string `yaml:"password"`
	PasswordFile string `yaml:"password_file"`
}

// ProbeConfig holds settings for a single Uptime Kuma probe node.
type ProbeConfig struct {
	Name         string   `yaml:"name"`
	Endpoint     string   `yaml:"endpoint"`
	Username     string   `yaml:"username"`
	Password     string   `yaml:"password"`
	PasswordFile string   `yaml:"password_file"`
	Tags         []string `yaml:"tags,omitempty"`
	Types        []string `yaml:"types,omitempty"`
	Enabled      *bool    `yaml:"enabled,omitempty"`
}

// IsEnabled returns whether the probe is enabled (defaults to true).
func (p *ProbeConfig) IsEnabled() bool {
	if p.Enabled == nil {
		return true
	}
	return *p.Enabled
}

// SyncConfig holds synchronization behavior settings.
type SyncConfig struct {
	Interval         time.Duration `yaml:"interval"`
	Concurrency      int           `yaml:"concurrency"`
	OperationTimeout time.Duration `yaml:"operation_timeout"`
	DeleteOrphans    bool          `yaml:"delete_orphans"`
	DryRun           bool          `yaml:"dry_run"`
}

// LogConfig holds logging settings.
type LogConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
}

// Load reads configuration from a YAML file and applies defaults.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	cfg := &Config{
		Master: MasterConfig{
			Port: 3306,
		},
		Sync: SyncConfig{
			Interval:         5 * time.Minute,
			Concurrency:      3,
			OperationTimeout: 30 * time.Second,
			DeleteOrphans:    true,
			DryRun:           false,
		},
		Logging: LogConfig{
			Level:  "info",
			Format: "json",
		},
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	// Load passwords from files if specified
	if cfg.Master.PasswordFile != "" {
		pwd, err := readPasswordFile(cfg.Master.PasswordFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read master password file: %w", err)
		}
		cfg.Master.Password = pwd
	}

	for i := range cfg.Probes {
		if cfg.Probes[i].PasswordFile != "" {
			pwd, err := readPasswordFile(cfg.Probes[i].PasswordFile)
			if err != nil {
				return nil, fmt.Errorf("failed to read probe %s password file: %w", cfg.Probes[i].Name, err)
			}
			cfg.Probes[i].Password = pwd
		}
	}

	// Validate configuration
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

// Validate checks that the configuration is valid.
func (c *Config) Validate() error {
	if c.Master.Host == "" {
		return fmt.Errorf("master.host is required")
	}
	if c.Master.Database == "" {
		return fmt.Errorf("master.database is required")
	}
	if c.Master.Username == "" {
		return fmt.Errorf("master.username is required")
	}
	if c.Master.Password == "" {
		return fmt.Errorf("master.password or master.password_file is required")
	}

	if len(c.Probes) == 0 {
		return fmt.Errorf("at least one probe must be configured")
	}

	for i, probe := range c.Probes {
		if probe.Name == "" {
			return fmt.Errorf("probes[%d].name is required", i)
		}
		if probe.Endpoint == "" {
			return fmt.Errorf("probes[%d].endpoint is required", i)
		}
		if probe.Username == "" {
			return fmt.Errorf("probes[%d].username is required", i)
		}
		if probe.Password == "" {
			return fmt.Errorf("probes[%d].password or password_file is required", i)
		}
	}

	if c.Sync.Interval < time.Second {
		return fmt.Errorf("sync.interval must be at least 1 second")
	}
	if c.Sync.Concurrency < 1 {
		return fmt.Errorf("sync.concurrency must be at least 1")
	}
	if c.Sync.OperationTimeout < time.Second {
		return fmt.Errorf("sync.operation_timeout must be at least 1 second")
	}

	return nil
}

// readPasswordFile reads a password from a file, trimming whitespace.
func readPasswordFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

// GetEnabledProbes returns only the probes that are enabled.
func (c *Config) GetEnabledProbes() []ProbeConfig {
	var enabled []ProbeConfig
	for _, p := range c.Probes {
		if p.IsEnabled() {
			enabled = append(enabled, p)
		}
	}
	return enabled
}

// LoadFromEnv creates configuration from environment variables.
// This is the preferred method for Docker deployments.
func LoadFromEnv() (*Config, error) {
	cfg := &Config{
		Master: MasterConfig{
			Host:     getEnv("IRIS_SYNC_DB_HOST", "localhost"),
			Port:     getEnvInt("IRIS_SYNC_DB_PORT", 3306),
			Database: getEnv("IRIS_SYNC_DB_NAME", "iris"),
			Username: getEnv("IRIS_SYNC_DB_USER", "iris"),
			Password: getEnv("IRIS_SYNC_DB_PASSWORD", ""),
		},
		Sync: SyncConfig{
			Interval:         getEnvDuration("IRIS_SYNC_INTERVAL", 5*time.Minute),
			Concurrency:      getEnvInt("IRIS_SYNC_CONCURRENCY", 3),
			OperationTimeout: getEnvDuration("IRIS_SYNC_OPERATION_TIMEOUT", 30*time.Second),
			DeleteOrphans:    getEnvBool("IRIS_SYNC_DELETE_ORPHANS", true),
			DryRun:           getEnvBool("IRIS_SYNC_DRY_RUN", false),
		},
		Logging: LogConfig{
			Level:  getEnv("IRIS_SYNC_LOG_LEVEL", "info"),
			Format: getEnv("IRIS_SYNC_LOG_FORMAT", "json"),
		},
	}

	// Parse IRIS_SYNC_PROBES as YAML from environment variable
	if probesYAML := os.Getenv("IRIS_SYNC_PROBES"); probesYAML != "" {
		if err := yaml.Unmarshal([]byte(probesYAML), &cfg.Probes); err != nil {
			return nil, fmt.Errorf("failed to parse IRIS_SYNC_PROBES: %w", err)
		}
	}

	// Load master password from file if IRIS_SYNC_DB_PASSWORD_FILE is set
	if pwdFile := os.Getenv("IRIS_SYNC_DB_PASSWORD_FILE"); pwdFile != "" {
		pwd, err := readPasswordFile(pwdFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read DB password file: %w", err)
		}
		cfg.Master.Password = pwd
	}

	// Validate configuration
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

// HasEnvConfig returns true if environment-based configuration is detected.
func HasEnvConfig() bool {
	return os.Getenv("IRIS_SYNC_DB_HOST") != "" || os.Getenv("IRIS_SYNC_PROBES") != ""
}

// getEnv returns environment variable value or default.
func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// getEnvInt returns environment variable as int or default.
func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		var result int
		if _, err := fmt.Sscanf(val, "%d", &result); err == nil {
			return result
		}
	}
	return defaultVal
}

// getEnvBool returns environment variable as bool or default.
func getEnvBool(key string, defaultVal bool) bool {
	if val := os.Getenv(key); val != "" {
		switch strings.ToLower(val) {
		case "true", "1", "yes", "on":
			return true
		case "false", "0", "no", "off":
			return false
		}
	}
	return defaultVal
}

// getEnvDuration returns environment variable as duration or default.
func getEnvDuration(key string, defaultVal time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return defaultVal
}
