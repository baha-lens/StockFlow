/* ============================================================================
   Back navigation
   ----------------------------------------------------------------------------
   The Android hardware back button is delivered to the Activity, not to the
   WebView, so with no handler it closes the app from any screen. This module
   installs a single listener that unwinds the app in the order a user expects:

     1. close the top-most modal
     2. close the nav overlay / any open drawer
     3. step back through the in-app page history
     4. return to the dashboard
     5. phone only, native only: double-tap within 2s to exit

   The page history is tracked here rather than relying on `location.hash`,
   because a hash change is not something a WebView back press will undo once
   the Activity owns the key event.

   Two rules shape the rest of this file.

   FORM FACTOR. "Exit" only exists where there is something to exit. A phone
   build is an app and can be closed; a desktop Electron window and a browser
   tab are documents inside a host the user is already managing, so step 5
   never runs there. Closing a modal on the desktop must not be able to
   navigate away, let alone close anything.

   OS INDEPENDENCE. The same unwinding is also reachable from a visible button
   in the top bar, wired to BackNav.step(), so the behaviour is identical
   whether it is triggered by a hardware key, a mouse, or a finger. Nothing
   here depends on an OS gesture existing.
   ========================================================================= */

const BackNav = {
  history: [],
  lastExitPress: 0,
  _pressTimer: null,

  /** Call after every route change. */
  track(page) {
    if (this.history[this.history.length - 1] !== page) this.history.push(page);
    /* Keep the stack bounded; the router is not a log of every visit. */
    if (this.history.length > 40) this.history.splice(0, this.history.length - 40);
  },

  reset(page) {
    this.history = [page];
  },

  /** True when a back press would actually do something. Drives whether the
   *  top bar's back button is shown at all, so it is never a dead control. */
  canStepBack() {
    if (state.modalStack && state.modalStack.length) return true;
    if (document.body.classList.contains('nav-open')) return true;
    if (qs('.drawer.open, .side-panel.open')) return true;
    if (this.history.length > 1) return true;
    return !!(state.route && state.route !== 'dashboard');
  },

  /** Exiting is a phone-and-native-only concept. See the header note. */
  canExit() {
    return !!Native.isNative() && (!Layout || Layout.isPhone());
  },

  /**
   * Jump straight to the dashboard, unwinding everything on the way.
   *
   * This is the "get me out of here" affordance, and it is the same on every
   * form factor: close any modal, close the nav overlay, clear the history so
   * a subsequent back press does not walk the user back into whatever they just
   * escaped, then go. Deliberately does not touch the session.
   */
  goHome() {
    closeAllModals();
    document.body.classList.remove('nav-open');
    this.history = ['dashboard'];
    if (state.route !== 'dashboard' || document.body.classList.contains('nav-open')) {
      go('dashboard');
    } else {
      renderAll();
    }
    this.paint();
  },

  /**
   * One step back. Split out from handle() so the top bar button, the Escape
   * key and the Android hardware key are literally the same code path — which
   * is the only way to guarantee they cannot drift apart.
   *
   * @returns {boolean} true when something was unwound and the app stays open
   */
  step() {
    /* 1. modal */
    if (state.modalStack && state.modalStack.length) {
      closeModal();
      this.paint();
      return true;
    }

    /* 2. nav overlay, then any open drawer */
    if (document.body.classList.contains('nav-open')) {
      document.body.classList.remove('nav-open');
      this.paint();
      return true;
    }
    const drawer = qs('.drawer.open, .side-panel.open');
    if (drawer) {
      drawer.classList.remove('open');
      this.paint();
      return true;
    }

    /* 3. step back through visited pages */
    if (this.history.length > 1) {
      this.history.pop();
      const prev = this.history[this.history.length - 1];
      if (prev && PAGE_META[prev]) {
        go(prev, { fromHistory: true });
        this.paint();
        return true;
      }
      /* A page the current role may no longer see, or one that was removed
       * from PAGE_META by a downgrade. Keep unwinding rather than dead-ending. */
      this.history = ['dashboard'];
    }

    /* 4. off the dashboard: go there. */
    if (state.route && state.route !== 'dashboard') {
      this.history = ['dashboard'];
      go('dashboard');
      this.paint();
      return true;
    }

    /* 5. Nothing left to unwind. */
    this.paint();
    return false;
  },

  /** The hardware-key entry point. Adds the exit gesture on top of step(). */
  handle() {
    if (this.step()) return true;

    /* On the dashboard with nothing open. Only a native phone build can be
     * closed from in here, and only on a deliberate second press. */
    if (this.canExit()) {
      const now = Date.now();
      if (now - this.lastExitPress < 2000) return false;   // let the OS close us
      this.lastExitPress = now;
      this._armExitHint();
      return true;
    }

    /* Desktop and web: swallow it. Returning false here would let a native
     * shell treat the press as "nothing handled" and close the window, which
     * is exactly the surprising behaviour this module exists to prevent. */
    if (Native.isNative()) {
      toast('You are on the dashboard', 'good', 1600);
    }
    return true;
  },

  /** Auto-clears the exit hint so a slow second press still counts as a
   *  double-tap rather than being treated as a fresh first press. */
  _armExitHint() {
    toast('Press back again to exit', 'warn');
    clearTimeout(this._pressTimer);
    this._pressTimer = setTimeout(() => { this.lastExitPress = 0; }, 2000);
  },

  /**
   * Show or hide the top bar's back and home buttons.
   *
   * The back button only appears when step() would do something, so it is
   * never a control that does nothing. The home button appears once the user is
   * anywhere other than the dashboard.
   */
  paint() {
    const back = $('backBtn');
    const home = $('homeBtn');
    const canBack = this.canStepBack();
    if (back) {
      back.classList.toggle('hidden', !canBack);
      back.title = canBack ? 'Back' : '';
    }
    if (home) home.classList.toggle('hidden', state.route === 'dashboard');
  },

  install() {
    if (Native.isNative()) {
      Native.onBack(() => BackNav.handle());
      /* Still install the visible controls on a phone: a hardware key is not
       * always reachable, and a user holding the device one-handed should not
       * have to find the OS gesture. */
    }

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      BackNav.step();
    });

    const back = $('backBtn');
    if (back) {
      back.onclick = () => BackNav.step();
      /* Long-press (or right-click, which is what a desktop user has) is the
       * shortcut to the dashboard. A single tap going "back" from three pages
       * deep should not require three taps, and the top bar is the obvious
       * place to look for "take me home". */
      let hold = null;
      const startHold = () => {
        clearTimeout(hold);
        hold = setTimeout(() => { BackNav.goHome(); toast('Dashboard', 'good', 1400); }, 480);
      };
      const cancelHold = () => clearTimeout(hold);
      back.addEventListener('pointerdown', startHold);
      back.addEventListener('pointerup', cancelHold);
      back.addEventListener('pointerleave', cancelHold);
      back.addEventListener('pointercancel', cancelHold);
      back.addEventListener('contextmenu', e => { e.preventDefault(); BackNav.goHome(); });
    }
    const home = $('homeBtn');
    if (home) home.onclick = () => BackNav.goHome();

    this.paint();
  }
};
