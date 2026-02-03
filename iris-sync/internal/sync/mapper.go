package sync

import (
	"encoding/json"
	"os"
	"sync"
)

// IDMapping tracks bidirectional relationships between master monitor IDs and probe local IDs.
// It also caches content hashes for change detection.
type IDMapping struct {
	mu            sync.RWMutex
	masterToProbe map[int64]int64  // master_id -> probe_local_id
	probeToMaster map[int64]int64  // probe_local_id -> master_id
	hashCache     map[int64]string // master_id -> content_hash
}

// NewIDMapping creates a new empty ID mapping instance.
func NewIDMapping() *IDMapping {
	return &IDMapping{
		masterToProbe: make(map[int64]int64),
		probeToMaster: make(map[int64]int64),
		hashCache:     make(map[int64]string),
	}
}

// SetMapping stores a bidirectional master-to-probe ID relationship.
func (m *IDMapping) SetMapping(masterID, probeID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Clean up any existing mappings for these IDs
	if oldProbeID, exists := m.masterToProbe[masterID]; exists {
		delete(m.probeToMaster, oldProbeID)
	}
	if oldMasterID, exists := m.probeToMaster[probeID]; exists {
		delete(m.masterToProbe, oldMasterID)
		delete(m.hashCache, oldMasterID)
	}

	m.masterToProbe[masterID] = probeID
	m.probeToMaster[probeID] = masterID
}

// GetProbeID returns the probe ID for a given master ID.
func (m *IDMapping) GetProbeID(masterID int64) (int64, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.masterToProbe[masterID]
	return id, ok
}

// GetMasterID returns the master ID for a given probe ID.
func (m *IDMapping) GetMasterID(probeID int64) (int64, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id, ok := m.probeToMaster[probeID]
	return id, ok
}

// RemoveByMasterID removes a mapping by master ID.
func (m *IDMapping) RemoveByMasterID(masterID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if probeID, ok := m.masterToProbe[masterID]; ok {
		delete(m.probeToMaster, probeID)
	}
	delete(m.masterToProbe, masterID)
	delete(m.hashCache, masterID)
}

// RemoveByProbeID removes a mapping by probe ID.
func (m *IDMapping) RemoveByProbeID(probeID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if masterID, ok := m.probeToMaster[probeID]; ok {
		delete(m.masterToProbe, masterID)
		delete(m.hashCache, masterID)
	}
	delete(m.probeToMaster, probeID)
}

// SetHash stores the content hash for a master ID.
func (m *IDMapping) SetHash(masterID int64, hash string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.hashCache[masterID] = hash
}

// GetHash retrieves the stored hash for a master ID.
func (m *IDMapping) GetHash(masterID int64) (string, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	hash, ok := m.hashCache[masterID]
	return hash, ok
}

// GetAllMasterIDs returns all known master IDs.
func (m *IDMapping) GetAllMasterIDs() []int64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ids := make([]int64, 0, len(m.masterToProbe))
	for id := range m.masterToProbe {
		ids = append(ids, id)
	}
	return ids
}

// GetAllProbeIDs returns all known probe IDs.
func (m *IDMapping) GetAllProbeIDs() []int64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ids := make([]int64, 0, len(m.probeToMaster))
	for id := range m.probeToMaster {
		ids = append(ids, id)
	}
	return ids
}

// Len returns the number of mappings.
func (m *IDMapping) Len() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.masterToProbe)
}

// Clear removes all mappings.
func (m *IDMapping) Clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.masterToProbe = make(map[int64]int64)
	m.probeToMaster = make(map[int64]int64)
	m.hashCache = make(map[int64]string)
}

// persistedMapping is the JSON-serializable format for ID mappings.
type persistedMapping struct {
	MasterToProbe map[int64]int64  `json:"master_to_probe"`
	HashCache     map[int64]string `json:"hash_cache"`
}

// SaveToFile persists the mapping to a JSON file.
func (m *IDMapping) SaveToFile(path string) error {
	m.mu.RLock()
	data := persistedMapping{
		MasterToProbe: make(map[int64]int64, len(m.masterToProbe)),
		HashCache:     make(map[int64]string, len(m.hashCache)),
	}
	for k, v := range m.masterToProbe {
		data.MasterToProbe[k] = v
	}
	for k, v := range m.hashCache {
		data.HashCache[k] = v
	}
	m.mu.RUnlock()

	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, jsonData, 0644)
}

// LoadFromFile loads the mapping from a JSON file.
func (m *IDMapping) LoadFromFile(path string) error {
	jsonData, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // File doesn't exist, start fresh
		}
		return err
	}

	var data persistedMapping
	if err := json.Unmarshal(jsonData, &data); err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.masterToProbe = data.MasterToProbe
	m.hashCache = data.HashCache
	m.probeToMaster = make(map[int64]int64, len(data.MasterToProbe))
	for masterID, probeID := range data.MasterToProbe {
		m.probeToMaster[probeID] = masterID
	}

	return nil
}

// MappingStore manages ID mappings for multiple probes with persistence.
type MappingStore struct {
	mu       sync.RWMutex
	mappings map[string]*IDMapping
	dataDir  string
}

// NewMappingStore creates a new mapping store with persistence directory.
func NewMappingStore(dataDir string) *MappingStore {
	return &MappingStore{
		mappings: make(map[string]*IDMapping),
		dataDir:  dataDir,
	}
}

// GetMapping returns the ID mapping for a specific probe, creating one if needed.
func (s *MappingStore) GetMapping(probeName string) *IDMapping {
	s.mu.Lock()
	defer s.mu.Unlock()

	if mapping, exists := s.mappings[probeName]; exists {
		return mapping
	}

	mapping := NewIDMapping()
	s.mappings[probeName] = mapping

	// Try to load from file
	if s.dataDir != "" {
		path := s.dataDir + "/" + probeName + ".json"
		_ = mapping.LoadFromFile(path) // Ignore error, start fresh if file doesn't exist
	}

	return mapping
}

// SaveAll persists all mappings to disk.
func (s *MappingStore) SaveAll() error {
	if s.dataDir == "" {
		return nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	// Ensure data directory exists
	if err := os.MkdirAll(s.dataDir, 0755); err != nil {
		return err
	}

	for probeName, mapping := range s.mappings {
		path := s.dataDir + "/" + probeName + ".json"
		if err := mapping.SaveToFile(path); err != nil {
			return err
		}
	}

	return nil
}
