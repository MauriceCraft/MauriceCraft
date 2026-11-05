interface CommandDefinition {
  name: string;
  usage: string;
  desc: string;
  fn: (args: string[]) => string | void;
  choices?: (argumentIndex: number, args: string[]) => string[];
}
export interface CommandConsoleDependencies {
  /** Called after opening the text field, to pause and clear movement. */
  onOpen: () => void;
  onClose: (resumeGame: boolean) => void;
  isDead: () => boolean;
  canOpen: () => boolean;
  isCommandOpen: () => boolean;
  /** Touchstart is wired by the mobile controls to avoid synthetic double clicks. */
  isTouch: boolean;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error('Missing game command UI #' + id);
  return element as T;
}

/** Own the command registry, chat history, input box and completion UI. */
export function createCommandConsole(deps: CommandConsoleDependencies) {
  const chatElement = requiredElement<HTMLElement>('chatlog');
  const commandBar = requiredElement<HTMLElement>('cmdbar');
  const commandInput = requiredElement<HTMLInputElement>('cmdinput');
  const commandButton = requiredElement<HTMLButtonElement>('btnCmd');
  const history: string[] = [];
  let historyIndex = 0;
  const visibleLines: HTMLElement[] = [];
  const commands: Record<string, CommandDefinition> = {};

  function chat(message: string, kind = ''): void {
    const line = document.createElement('div');
    line.className = 'cl' + (kind ? ' ' + kind : '');
    line.textContent = message;
    chatElement.appendChild(line);
    visibleLines.push(line);
    while (visibleLines.length > 9) {
      visibleLines.shift()?.remove();
    }
    setTimeout(() => {
      const index = visibleLines.indexOf(line);
      if (index >= 0) {
        visibleLines.splice(index, 1);
        line.remove();
      }
    }, 12_000);
  }

  function defCmd(
    names: string[],
    usage: string,
    description: string,
    handler: (args: string[]) => string | void,
    choices?: (argumentIndex: number, args: string[]) => string[],
  ): void {
    const definition: CommandDefinition = {
      name: names[0], usage, desc: description, fn: handler, choices,
    };
    for (const alias of names) commands[alias] = definition;
  }

  function execute(line: string): void {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;
    if (!trimmedLine.startsWith('/')) { chat('[You] ' + trimmedLine); return; }
    chat(trimmedLine, 'echo');
    const parts = trimmedLine.slice(1).trim().split(/\s+/);
    const name = (parts.shift() ?? '').toLowerCase();
    if (!name) return;
    const command = commands[name];
    if (!command) { chat('Unknown command "' + name + '". Type /help for the list.', 'bad'); return; }
    try {
      const output = command.fn(parts);
      if (output) chat(output);
    } catch (error) {
      chat(error instanceof Error ? error.message : String(error), 'bad');
    }
  }

  function openCmd(prefill = ''): void {
    deps.onOpen();
    commandBar.classList.remove('hidden');
    commandInput.value = prefill;
    historyIndex = history.length;
    if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(() => commandInput.focus(), 0);
  }

  function completeCmd(): void {
    const parts = commandInput.value.replace(/^\//, '').split(/\s+/);
    if (parts.length === 1) {
      const matches = Object.keys(commands).filter(name => name.startsWith(parts[0].toLowerCase()));
      if (matches.length === 1) commandInput.value = '/' + matches[0] + ' ';
      else if (matches.length > 1) chat(matches.join('  '), 'echo');
      return;
    }
    const command = commands[parts[0].toLowerCase()];
    if (!command?.choices) return;
    const currentValue = (parts[parts.length - 1] ?? '').toLowerCase();
    const matches = command.choices(parts.length - 1, parts)
      .filter(value => String(value).startsWith(currentValue));
    if (matches.length === 1) {
      parts[parts.length - 1] = matches[0];
      commandInput.value = '/' + parts.join(' ') + ' ';
    } else if (matches.length > 1) {
      chat(matches.slice(0, 14).join('  ') + (matches.length > 14 ? '  ...' : ''), 'echo');
    }
  }

  commandInput.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      const line = commandInput.value;
      if (line.trim()) {
        history.push(line);
        if (history.length > 50) history.shift();
      }
      execute(line);
      deps.onClose(!deps.isDead());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      deps.onClose(false);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      completeCmd();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (historyIndex > 0) commandInput.value = history[--historyIndex];
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex < history.length - 1) commandInput.value = history[++historyIndex];
      else { historyIndex = history.length; commandInput.value = ''; }
    }
  });
  commandInput.addEventListener('keyup', event => event.stopPropagation());

  window.addEventListener('keydown', event => {
    if (deps.isCommandOpen() || !deps.canOpen() || event.repeat) return;
    if (event.code === 'KeyT') { event.preventDefault(); openCmd(); }
    else if (event.key === '/') { event.preventDefault(); openCmd('/'); }
  });
  commandButton.addEventListener('click', () => {
    if (!deps.isTouch && deps.canOpen()) openCmd('/');
  });

  return { commands, commandBar, commandInput, chat, defCmd, execute,
    openCmd, completeCmd };
}
