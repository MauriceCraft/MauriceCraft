import './styles/global.css';
import { monitorStartup, showStartupFailure } from './startup/startup-health';

// Dynamic loading lets us show an error even if WebGL setup or another
// imported game module throws before the normal world initializer runs.
monitorStartup();
void import('./game/bootstrap').catch(error => showStartupFailure(error));
