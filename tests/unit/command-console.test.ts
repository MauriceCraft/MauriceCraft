import { describe, expect, it } from 'vitest';
import { createCommandConsole } from '../../src/game/commands/command-console';

/** Minimal browser facade for command testing in the existing Node test runner. */
function fixture() {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  type FakeNode = { textContent: string; className: string;
    value: string; listeners: Record<string, (e: KeyboardEvent) => void>;
    children: FakeNode[]; classList: { remove: () => void };
    appendChild: (node: FakeNode) => void; remove: () => void;
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => void; focus: () => void };
  function makeNode(): FakeNode {
    const node: FakeNode = {
      textContent: '', className: '', value: '', listeners: {}, children: [],
      classList: { remove: () => undefined },
      appendChild(child) { node.children.push(child); },
      remove: () => undefined,
      addEventListener(type, listener) { node.listeners[type] = listener; },
      focus: () => undefined,
    };
    return node;
  }
  const nodes: Record<string, FakeNode> = {
    chatlog: makeNode(), cmdbar: makeNode(), cmdinput: makeNode(), btnCmd: makeNode(),
  };
  const doc = {
    getElementById: (id: string) => nodes[id],
    createElement: () => makeNode(),
    pointerLockElement: null,
  };
  const win = { addEventListener: () => undefined };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
  return {
    nodes,
    restore: () => {
      Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true });
      Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    },
  };
}
describe('command registry', () => {
  it('supports aliases, command exceptions and normal messages', () => {
    const { nodes, restore } = fixture();
    try {
      // The HTML button instanceof check is deliberately avoided in this module.
      const system = createCommandConsole({
        onOpen: () => undefined, onClose: () => undefined, isDead: () => false,
        canOpen: () => true, isCommandOpen: () => false, isTouch: false,
      });
      system.defCmd(['hello', 'hi'], '/hello', 'Greet', () => 'Hello Maurice!');
      system.execute('/hi');
      system.execute('regular chat');
      system.execute('/missing');
      expect(nodes.chatlog.children.map(line => line.textContent)).toContain('Hello Maurice!');
      expect(nodes.chatlog.children.map(line => line.textContent)).toContain('[You] regular chat');
      expect(nodes.chatlog.children.map(line => line.textContent)).toContain('Unknown command "missing". Type /help for the list.');
    } finally { restore(); }
  });
});
