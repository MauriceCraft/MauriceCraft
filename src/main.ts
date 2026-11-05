import './styles/global.css';
import { monitorStartup, showStartupFailure } from './startup/startup-health';

// Preserve graceful WebGL/error handling and explicitly start only after import.
monitorStartup();
void import('./game/bootstrap')
  .then(({ startGameApplication }) => startGameApplication())
  .catch(error => showStartupFailure(error));
