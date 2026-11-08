/** Replaces the view with a readable error. The app has no fallback mode, so this is terminal. */
export const showFatalError = (error: Error): void => {
  const overlay = document.createElement('div');
  overlay.dataset['testid'] = 'fatal-error';
  overlay.textContent = error.message;
  document.body.append(overlay);
};
