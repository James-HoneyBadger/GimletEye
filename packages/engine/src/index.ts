/**
 * The engine's public surface.
 *
 * The container is the part that must never drift: files written by older
 * builds have to keep opening, so its fixtures are tests, not examples.
 */

export * from './container.js';
