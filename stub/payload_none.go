//go:build !portable

package main

// The plain stub carries no payload. It is the binary registered as the .md
// handler; bootstrapping is the portable build's job.

const hasPayload = false

func payloadBytes() []byte { return nil }
