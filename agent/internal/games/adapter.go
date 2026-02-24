package games

import (
	"github.com/mastermind/agent/internal/agent"
)

// Registry holds game adapters for plugin-style dispatch. Key = game type slug (e.g. "7dtd", "minecraft").
type Registry struct {
	adapters map[string]agent.GameAdapter
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{adapters: make(map[string]agent.GameAdapter)}
}

// Register adds a game adapter (e.g. 7dtd, minecraft).
func (r *Registry) Register(a agent.GameAdapter) {
	r.adapters[a.Name()] = a
}

// Get returns the adapter for the given game type, or nil.
func (r *Registry) Get(gameType string) agent.GameAdapter {
	return r.adapters[gameType]
}

// GetOrNoop returns the adapter for the game type, or a no-op adapter for that name.
func (r *Registry) GetOrNoop(gameType string) agent.GameAdapter {
	if a := r.adapters[gameType]; a != nil {
		return a
	}
	return &agent.NoopGameAdapter{GameName: gameType}
}
