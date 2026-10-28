# Fixed-time small-gain theorems: interactive companion

Live at **https://myxtang.com/FxT-SGT/**

An interactive page for two papers by Michael Tang, Miroslav Krstic and Jorge I. Poveda:

- *A Lyapunov-Based Small-Gain Theorem for Fixed-Time ISS: Theory, Optimization, and Games*, IEEE Transactions on Automatic
  Control, 2027. [DOI 10.1109/TAC.2026.3738248](https://doi.org/10.1109/TAC.2026.3738248), [arXiv:2512.21314](https://arxiv.org/abs/2512.21314)
- *A Lyapunov-Based Small-Gain Theorem for Fixed-Time Stability*, American Control Conference, 2026 (Best Student Paper Award).
  [arXiv:2511.23474](https://arxiv.org/abs/2511.23474)

It runs the papers' examples live in the browser: a scalar finite- vs fixed-time comparison, the coupled example of ACC
Theorem 2 with a live small-gain check, example (19) of the journal paper with and without inputs, feedback optimization
without time-scale separation (journal §IV-C), and Nash seeking with a plant in the loop (journal §V-B).

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page content and math (MathJax 3, loaded from jsDelivr) |
| `style.css` | Layout and colours (blue = subsystem/player 1, amber = subsystem/player 2) |
| `js/sim.js` | The models, written from the papers' equations, and the solver |
| `js/plot.js` | Small canvas plotting helper |
| `js/app.js` | Connects the sliders to the simulations and plots |
| `assets/preview.png` | Image shown when the link is shared |

No build step: GitHub Pages serves the repository root from `main`.

## Numerics

Fixed-time vector fields are not Lipschitz at the origin and are stiff far from it, so the page uses the L-stable
second-order Rosenbrock method ROS2 (Verwer et al., 1999) with adaptive steps and a numerical Jacobian. Fractional powers
are continued linearly below 1e-14, far under the plots' 1e-12 floor. The optimization and game examples are integrated
in error coordinates (distance to the optimizer or Nash equilibrium). The results were cross-checked against an
independent SciPy (Radau) implementation in the original coordinates.

To run locally, serve the folder (for example `python3 -m http.server`) and open http://localhost:8000.
