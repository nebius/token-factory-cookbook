class ModelBenchmark {
    // Per-benchmark request counts / prompts
    static TEST_COUNT = 10;
    static PURE_SPEED_TEST_COUNT = 10;
    static PURE_SPEED_PROMPT = "Hi";
    // Per-request timeout. Generous enough for slow/thinking models on the
    // harder Bench 2 (UUID retrieval) task, but still bounds a hung model so
    // one phase can't stall ~100s. A request exceeding this returns a timeout
    // failure, lowering the model's success rate toward a ❌ FAIL.
    static TIMEOUT_MS = 45000;
    static PASS_RATE_THRESHOLD = 80;
    static NUM_UUIDS = 20;
    static TRIM_LOW_COUNT = 2;
    static TRIM_HIGH_COUNT = 2;

    /**
     * Sortable column registry for the results table. Drives the header
     * <th data-sort="..."> keys, the value extractor, and the comparison.
     * Rank is excluded (it is positional, never sorted).
     */
    static SORT_COLUMNS = [
        { key: 'model',          label: 'Model',        type: 'string' },
        { key: 'medianLatency',  label: 'Median',       type: 'number' },
        { key: 'averageLatency', label: 'Avg',          type: 'number' },
        { key: 'minLatency',     label: 'Min',          type: 'number' },
        { key: 'maxLatency',     label: 'Max',          type: 'number' },
        { key: 'successRate',    label: 'Success Rate', type: 'number' },
        { key: 'requests',       label: 'Requests',     type: 'requests' }
    ];

    // The default ordering (used until the user clicks a header) is the
    // pass-bucketed ranking in _defaultSortedResults: passing models first
    // by ascending median, then failing models by descending success rate.
    // Because the passing block IS a single-key median-ascending sort (and
    // failed rows always sink with '-' regardless of column), we show a ▲ on
    // Median by default. First click on Median flips it to desc; a fresh
    // column starts asc.
    static DEFAULT_SORT_COLUMN = 'medianLatency';
    static DEFAULT_SORT_DIRECTION = 'asc';

    /**
     * Benchmark registry — single source of truth for every benchmark.
     * To add a new benchmark: append an entry here, add a `run<benchId>`
     * runner method that pushes results into this.benchResults[id], and
     * add one call in the click handler's run sequence.
     *  - id:          stable key used everywhere (result array, tab dataset)
     *  - tabLabel:    text shown on the results-modal tab
     *  - consoleBanner: heading printed in the console run banner
     *  - runner:      method name on `this` that runs one model's benchmark
     */
    static BENCHMARKS = [
        {
            id: 'responseTime',
            tabLabel: 'Bench 1 - Response Time',
            consoleBanner: 'BENCH 1 — RESPONSE TIME',
            runner: 'benchmarkResponseTimeModel'
        },
        {
            id: 'thinking1',
            tabLabel: 'Bench 2 - Thinking 1 (random line)',
            consoleBanner: 'BENCH 2 — THINKING 1 (RANDOM LINE)',
            runner: 'benchmarkThinking1Model'
        }
    ];

    constructor() {
        // Keyed by benchmark id from the registry. Each value is an array
        // of per-model result objects with a shared field shape.
        this.benchResults = {};
        ModelBenchmark.BENCHMARKS.forEach(b => { this.benchResults[b.id] = []; });
        this.activeTab = ModelBenchmark.BENCHMARKS[0].id; // first tab active by default
        this.sortState = {}; // per-bench sort: { [benchId]: { column, direction } }
        this.initModal();
        this.initSortButtons();
    }

    /** Look up a benchmark definition by id. */
    getBench(id) {
        return ModelBenchmark.BENCHMARKS.find(b => b.id === id);
    }

    getDisplayName(modelId) {
        // Extract just the model name from paths like "openai/gpt-4" -> "gpt-4"
        return modelId.split('/').pop();
    }

    initSortButtons() {
        this.sortByNameBtn = document.getElementById('sort-by-name-btn');
        this.sortBySpeedBtn = document.getElementById('sort-by-speed-btn');

        if (this.sortByNameBtn) {
            this.sortByNameBtn.addEventListener('click', () => this.sortModelsByName());
        }

        if (this.sortBySpeedBtn) {
            this.sortBySpeedBtn.addEventListener('click', () => this.sortModelsBySpeed());
        }
    }

    sortModelsByName() {
        if (typeof availableModels === 'undefined' || availableModels.length === 0) {
            console.warn('❌ No models available to sort');
            return;
        }

        console.log('🔄 Sorting models by name (alphabetical)');

        // Sort availableModels alphabetically by id
        availableModels.sort((a, b) => a.id.localeCompare(b.id));

        this._repopulateDropdowns();

        console.log('✅ Models sorted by name successfully');
    }

    /** Re-populate both player model dropdowns from availableModels. */
    _repopulateDropdowns() {
        const player1ModelOptions = document.getElementById('player1-model-options');
        const player2ModelOptions = document.getElementById('player2-model-options');
        if (player1ModelOptions) populateSearchableDropdown(player1ModelOptions, availableModels, 'player1');
        if (player2ModelOptions) populateSearchableDropdown(player2ModelOptions, availableModels, 'player2');
    }

    /**
     * Toggles the "Sort by Benchmark" flyout submenu anchored beneath the
     * button. Each row is a benchmark that has results; selecting one applies
     * that benchmark's sort to the model dropdowns and collapses the menu.
     * The button is disabled until results exist, so we assume data is present.
     */
    sortModelsBySpeed() {
        if (typeof availableModels === 'undefined' || availableModels.length === 0) {
            console.warn('❌ No models available to sort');
            return;
        }
        if (!this.sortBySpeedBtn) return;

        // Toggle: if already open, close it.
        if (this._sortMenu && this._sortMenu.parentNode) {
            this._closeSortMenu();
            return;
        }

        const benchesWithData = ModelBenchmark.BENCHMARKS.filter(
            b => (this.benchResults[b.id] || []).length > 0
        );
        if (benchesWithData.length === 0) {
            // Button should be disabled in this state, but guard anyway.
            console.warn('❌ No benchmark results available. Run benchmarks first.');
            return;
        }

        const itemsHTML = benchesWithData.map(b => {
            const results = this.benchResults[b.id];
            const passed = results.filter(r => parseFloat(r.successRate) >= ModelBenchmark.PASS_RATE_THRESHOLD).length;
            return `
                <button type="button" class="benchmark-menu-item" data-bench="${b.id}">
                    <span class="benchmark-menu-title">${b.tabLabel}</span>
                    <span class="benchmark-menu-meta">${results.length} models · ${passed} passed</span>
                </button>
            `;
        }).join('');

        const menu = document.createElement('div');
        menu.className = 'benchmark-sort-menu';
        menu.innerHTML = itemsHTML;
        // Append to <body> and position with getBoundingClientRect so the
        // flyout escapes any overflow:hidden / scrollable ancestor (the Extra
        // panel) — a true page-level menu that opens to the RIGHT of the button.
        document.body.appendChild(menu);
        this._sortMenu = menu;
        this._positionSortMenu(); // place it relative to the button
        this.sortBySpeedBtn.classList.add('benchmark-sort-btn-active');
        this.sortBySpeedBtn.setAttribute('aria-expanded', 'true');

        // Apply sort on row click, then collapse.
        menu.querySelectorAll('.benchmark-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                this._applyBenchmarkSort(item.dataset.bench);
                this._closeSortMenu();
            });
        });

        // Outside-click / Escape dismisses the menu.
        this._sortMenuOutsideHandler = (e) => {
            if (!menu.contains(e.target) && e.target !== this.sortBySpeedBtn) {
                this._closeSortMenu();
            }
        };
        this._sortMenuKeyHandler = (e) => {
            if (e.key === 'Escape') this._closeSortMenu();
        };
        // Keep the menu pinned to the button while the page scrolls/resizes.
        this._sortMenuRepositionHandler = () => this._positionSortMenu();
        // Defer attaching so the click that opened the menu doesn't immediately close it.
        setTimeout(() => {
            document.addEventListener('click', this._sortMenuOutsideHandler);
            document.addEventListener('keydown', this._sortMenuKeyHandler);
            window.addEventListener('scroll', this._sortMenuRepositionHandler, true);
            window.addEventListener('resize', this._sortMenuRepositionHandler);
        }, 0);
    }

    _closeSortMenu() {
        if (this._sortMenu && this._sortMenu.parentNode) {
            this._sortMenu.parentNode.removeChild(this._sortMenu);
        }
        this._sortMenu = null;
        if (this._sortMenuOutsideHandler) {
            document.removeEventListener('click', this._sortMenuOutsideHandler);
            this._sortMenuOutsideHandler = null;
        }
        if (this._sortMenuKeyHandler) {
            document.removeEventListener('keydown', this._sortMenuKeyHandler);
            this._sortMenuKeyHandler = null;
        }
        if (this._sortMenuRepositionHandler) {
            window.removeEventListener('scroll', this._sortMenuRepositionHandler, true);
            window.removeEventListener('resize', this._sortMenuRepositionHandler);
            this._sortMenuRepositionHandler = null;
        }
        if (this.sortBySpeedBtn) {
            this.sortBySpeedBtn.classList.remove('benchmark-sort-btn-active');
            this.sortBySpeedBtn.setAttribute('aria-expanded', 'false');
        }
    }

    /**
     * Position the flyout menu just to the right of the button, vertically
     * aligned to its top. Falls back to below+left if there's no room on the
     * right. Uses fixed coordinates so it isn't affected by page scroll.
     */
    _positionSortMenu() {
        if (!this._sortMenu || !this.sortBySpeedBtn) return;
        const btnRect = this.sortBySpeedBtn.getBoundingClientRect();
        const menu = this._sortMenu;
        // Measure once placed to decide edge flips.
        menu.style.left = '0px';
        menu.style.top = '0px';
        const menuRect = menu.getBoundingClientRect();

        let left = btnRect.right + 6;
        // Flip to the left side if it would overflow the viewport's right edge.
        if (left + menuRect.width > window.innerWidth) {
            left = btnRect.left - menuRect.width - 6;
        }
        // If that's off the left edge too, fall back to opening below the button.
        if (left < 8) {
            left = Math.max(8, btnRect.left);
            menu.style.top = `${btnRect.bottom + 6}px`;
        } else {
            menu.style.top = `${btnRect.top}px`;
        }
        menu.style.left = `${left}px`;
        // Clamp vertically so a long menu never runs off the bottom of the screen.
        const maxTop = Math.max(8, window.innerHeight - menuRect.height - 8);
        const currentTop = parseFloat(menu.style.top);
        if (currentTop > maxTop) {
            menu.style.top = `${maxTop}px`;
        }
    }

    /**
     * Sorts availableModels by the selected benchmark's results (passing
     * models first by speed, failing models last by success rate) and
     * re-populates both player dropdowns.
     */
    _applyBenchmarkSort(benchId) {
        const results = this.benchResults[benchId] || [];
        if (results.length === 0) {
            console.warn(`❌ No results for benchmark "${benchId}"`);
            return;
        }

        const bench = this.getBench(benchId);
        console.log(`🔄 Sorting models by benchmark — using "${bench.tabLabel}" results (≥80% pass rate first)`);

        // Sort availableModels based on benchmark results with 80% pass rate threshold
        availableModels.sort((a, b) => {
            const resultA = results.find(r => r.model === a.id);
            const resultB = results.find(r => r.model === b.id);

            const latencyA = resultA ? parseFloat(resultA.medianLatency) : Infinity;
            const latencyB = resultB ? parseFloat(resultB.medianLatency) : Infinity;
            const successRateA = resultA ? parseFloat(resultA.successRate) : 0;
            const successRateB = resultB ? parseFloat(resultB.successRate) : 0;

            // Failed models (below 80%) go to the end
            const aFailed = successRateA < ModelBenchmark.PASS_RATE_THRESHOLD;
            const bFailed = successRateB < ModelBenchmark.PASS_RATE_THRESHOLD;

            if (aFailed && !bFailed) return 1;  // a failed, b passed -> a after b
            if (!aFailed && bFailed) return -1; // a passed, b failed -> a before b
            if (aFailed && bFailed) {
                // Both failed: sort by success rate (highest first)
                return successRateB - successRateA;
            }

            // Both passed: sort by speed (fastest first)
            return latencyA - latencyB;
        });

        this._repopulateDropdowns();

        console.log(`✅ Models sorted by "${bench.tabLabel}" successfully`);
    }

    updateSortButtonState() {
        const hasResults = ModelBenchmark.BENCHMARKS.some(b => (this.benchResults[b.id] || []).length > 0);
        if (this.sortBySpeedBtn) {
            if (hasResults) {
                this.sortBySpeedBtn.classList.remove('btn-disabled');
                this.sortBySpeedBtn.title = 'Sort models by benchmark (choose which benchmark)';
            } else {
                this.sortBySpeedBtn.classList.add('btn-disabled');
                this.sortBySpeedBtn.title = 'Sort models by benchmark (run benchmarks first)';
            }
        }

        // Also update show results button state
        if (this.showResultsBtn) {
            if (hasResults) {
                this.showResultsBtn.classList.remove('btn-disabled');
                this.showResultsBtn.title = 'Show benchmark results';
            } else {
                this.showResultsBtn.classList.add('btn-disabled');
                this.showResultsBtn.title = 'Show benchmark results (run benchmarks first)';
            }
        }
    }

    stopBenchmarkTimer() {
        if (this.benchmarkTimer) {
            clearInterval(this.benchmarkTimer);
            this.benchmarkTimer = null;
        }
        // Final time calculation with null check
        if (this.benchmarkStartTime) {
            this.benchmarkElapsedTime = Math.floor((Date.now() - this.benchmarkStartTime) / 1000);
        }
    }

    formatBenchmarkTime(seconds) {
        if (seconds < 60) {
            return `${seconds}s`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const remainingSeconds = seconds % 60;
            return `${hours}h ${minutes}m ${remainingSeconds}s`;
        }
    }

    initModal() {
        // Get modal elements
        this.modal = document.getElementById('benchmark-modal');
        this.showResultsBtn = document.getElementById('show-results-btn');
        this.closeModalBtn = document.getElementById('close-modal-btn');
        this.resultsContainer = document.getElementById('benchmark-results-container');

        if (this.showResultsBtn && this.modal) {
            this.showResultsBtn.addEventListener('click', () => this.showResultsInModal());
        }

        if (this.closeModalBtn && this.modal) {
            this.closeModalBtn.addEventListener('click', () => this.hideModal());
        }

        // Close modal with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
                this.hideModal();
            }
        });
    }

    showResultsInModal() {
        if (!this.resultsContainer || !this.modal) return;

        // Determine which benchmarks have data
        const benchesWithData = ModelBenchmark.BENCHMARKS.filter(b => (this.benchResults[b.id] || []).length > 0);

        if (benchesWithData.length === 0) {
            this.resultsContainer.innerHTML = this._renderNoResults(
                'No benchmark results available',
                'Run the benchmarks first by clicking "Run Benchmarks"'
            );
            this.modal.classList.remove('hidden');
            return;
        }

        // Default to the active tab if it has data, else the first benchmark with data.
        const activeHasData = benchesWithData.some(b => b.id === this.activeTab);
        const activeId = activeHasData ? this.activeTab : benchesWithData[0].id;
        this.activeTab = activeId;

        // Build the tab bar + one view per benchmark (driven by the registry)
        const tabsHTML = ModelBenchmark.BENCHMARKS.map(b => {
            const isActive = b.id === activeId;
            const hasData = benchesWithData.some(d => d.id === b.id);
            const classes = ['benchmark-tab'];
            if (isActive) classes.push('active');
            if (!hasData) classes.push('benchmark-tab-empty');
            return `<button class="${classes.join(' ')}" data-tab="${b.id}">${b.tabLabel}</button>`;
        }).join('\n            ');

        const viewsHTML = ModelBenchmark.BENCHMARKS.map(b => {
            const isHidden = b.id !== activeId ? 'hidden' : '';
            const results = this.benchResults[b.id] || [];
            const content = results.length > 0
                ? this._renderBenchmarkTable(results, b.tabLabel, b.id)
                : this._renderNoResults(`${b.tabLabel} — no results`, 'Run the benchmarks first.');
            return `<div class="benchmark-view ${isHidden}" data-view="${b.id}">${content}</div>`;
        }).join('\n            ');

        this.resultsContainer.innerHTML = `
            <div class="benchmark-tabs">
            ${tabsHTML}
            </div>
            ${viewsHTML}
        `;

        // Wire up tab switching via event delegation
        const tabs = this.resultsContainer.querySelectorAll('.benchmark-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
        });

        // Wire up sortable column headers (re-render the clicked view)
        const sortableHeaders = this.resultsContainer.querySelectorAll('.benchmark-sortable');
        sortableHeaders.forEach(th => {
            th.addEventListener('click', () => this._sortTable(th));
        });

        this.modal.classList.remove('hidden');
    }

    /**
     * Sort the table inside the view that owns `th`. Toggle direction when
     * re-clicking the same column; fresh column starts ascending.
     */
    _sortTable(th) {
        const view = th.closest('.benchmark-view');
        if (!view) return;
        const benchId = view.dataset.view;
        const column = th.dataset.sort;

        const prev = this.sortState[benchId];
        // Treat the displayed default sort as the starting baseline so the
        // first click on the default column (Median) flips it to desc, and a
        // fresh column starts asc. Re-clicking the same column toggles.
        const baseCol = prev ? prev.column : ModelBenchmark.DEFAULT_SORT_COLUMN;
        const baseDir = prev ? prev.direction : ModelBenchmark.DEFAULT_SORT_DIRECTION;
        let direction;
        if (column === baseCol) {
            direction = baseDir === 'asc' ? 'desc' : 'asc';
        } else {
            direction = 'asc';
        }
        this.sortState[benchId] = { column, direction };

        // Re-render only this view's table and swap it in place.
        const results = this.benchResults[benchId] || [];
        const bench = this.getBench(benchId);
        if (results.length === 0 || !bench) return;
        view.innerHTML = this._renderBenchmarkTable(results, bench.tabLabel, benchId);

        // Re-bind sortable headers within this freshly-rendered view.
        view.querySelectorAll('.benchmark-sortable').forEach(h => {
            h.addEventListener('click', () => this._sortTable(h));
        });
    }

    _switchTab(tabName) {
        this.activeTab = tabName;
        const tabs = this.resultsContainer.querySelectorAll('.benchmark-tab');
        const views = this.resultsContainer.querySelectorAll('.benchmark-view');
        tabs.forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabName);
        });
        views.forEach(v => {
            v.classList.toggle('hidden', v.dataset.view !== tabName);
        });
    }

    _renderNoResults(message, subMessage = '') {
        const sub = subMessage
            ? `<p style="font-size: 0.9em; margin-top: 10px;">${subMessage}</p>`
            : '';
        return `
            <div class="benchmark-no-results">
                <p>📊 ${message}</p>
                ${sub}
            </div>
        `;
    }

    /**
     * Default ordering: passed (≥80%) models sorted by median latency
     * (fastest first), then failed models sorted by success rate (highest
     * first). Used until the user clicks a column header.
     */
    _defaultSortedResults(results) {
        const passedResults = results.filter(r => parseFloat(r.successRate) >= ModelBenchmark.PASS_RATE_THRESHOLD);
        const failedResults = results.filter(r => parseFloat(r.successRate) < ModelBenchmark.PASS_RATE_THRESHOLD);

        const sortedPassed = [...passedResults].sort((a, b) =>
            parseFloat(a.medianLatency) - parseFloat(b.medianLatency)
        );
        const sortedFailed = [...failedResults].sort((a, b) =>
            parseFloat(b.successRate) - parseFloat(a.successRate)
        );
        return [...sortedPassed, ...sortedFailed];
    }

    /**
     * Extract a comparable value for a sortable column.
     * "requests" is special-cased to successful/total ratio so e.g.
     * "10/10" sorts above "5/10".
     */
    _sortValue(result, col) {
        if (col.type === 'requests') {
            return result.totalRequests > 0
                ? result.successfulRequests / result.totalRequests
                : 0;
        }
        if (col.type === 'string') {
            return this.getDisplayName(result.model).toLowerCase();
        }
        return parseFloat(result[col.key]);
    }

    _userSortedResults(results, column, direction) {
        const col = ModelBenchmark.SORT_COLUMNS.find(c => c.key === column);
        if (!col) return this._defaultSortedResults(results);

        const dir = direction === 'desc' ? -1 : 1;
        const isFailed = r => parseFloat(r.successRate) < ModelBenchmark.PASS_RATE_THRESHOLD;
        return [...results].sort((a, b) => {
            // Failed models have no valid numbers — always sink to the bottom,
            // regardless of sort column or direction. They keep their original
            // relative order (stable) below the passing models.
            const aFailed = isFailed(a);
            const bFailed = isFailed(b);
            if (aFailed !== bFailed) return aFailed ? 1 : -1;
            if (aFailed && bFailed) return 0;

            const av = this._sortValue(a, col);
            const bv = this._sortValue(b, col);
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            // Tie-break by median latency so stable-looking order persists
            return (parseFloat(a.medianLatency) - parseFloat(b.medianLatency)) * dir;
        });
    }

    /**
     * Renders the latency/accuracy table shared by all benchmarks.
     * Both result sets share the same field shape (medianLatency,
     * averageLatency, successRate, …), so a single renderer works.
     * Headers are clickable to sort; sort state is per-bench (benchId).
     */
    _renderBenchmarkTable(results, label, benchId) {
        const state = this.sortState[benchId];
        const sortedResults = state
            ? this._userSortedResults(results, state.column, state.direction)
            : this._defaultSortedResults(results);

        const totalPassed = results.filter(r => parseFloat(r.successRate) >= ModelBenchmark.PASS_RATE_THRESHOLD).length;
        const totalFailed = results.length - totalPassed;

        // Build <th> cells: Rank (non-sortable), then the registry columns.
        // Show the default Median ▲ as active until the user clicks a header —
        // the default ordering's passing block IS median-ascending.
        const activeCol = state ? state.column : ModelBenchmark.DEFAULT_SORT_COLUMN;
        const activeDir = state ? state.direction : ModelBenchmark.DEFAULT_SORT_DIRECTION;

        const headerCells = ['<th class="benchmark-th-rank">Rank</th>']
            .concat(ModelBenchmark.SORT_COLUMNS.map(col => {
                const isActive = col.key === activeCol;
                const caret = isActive ? (activeDir === 'desc' ? ' ▼' : ' ▲') : '';
                return `<th class="benchmark-sortable${isActive ? ' benchmark-sortable-active' : ''}" data-sort="${col.key}" title="Sort by ${col.label}">${col.label}${caret}</th>`;
            }))
            .join('');

        let tableHTML = `
            <div class="benchmark-results-table-wrapper">
                <div class="benchmark-summary">
                    <div class="benchmark-summary-line">
                        ${label} — models tested: ${sortedResults.length}, time taken: ${this.formatBenchmarkTime(this.benchmarkElapsedTime)}, passed (≥80%): ${totalPassed}, failed: ${totalFailed}
                    </div>
                </div>
                <table class="benchmark-results-table">
                    <thead>
                        <tr>${headerCells}</tr>
                    </thead>
                    <tbody>
        `;

        sortedResults.forEach((result, index) => {
            const rank = `${index + 1}`;
            const successRate = parseFloat(result.successRate);
            const failed = successRate < ModelBenchmark.PASS_RATE_THRESHOLD;

            // Color code latency (use median for color coding)
            let latencyClass = 'benchmark-latency-positive';
            const medianLatency = parseFloat(result.medianLatency);
            if (medianLatency > 500) {
                latencyClass = 'benchmark-latency-critical';
            } else if (medianLatency > 300) {
                latencyClass = 'benchmark-latency-warning';
            }

            // Color code success rate
            let successClass = 'benchmark-success-high';
            if (failed) {
                successClass = 'benchmark-success-low';
            } else if (successRate < 100) {
                successClass = 'benchmark-success-medium';
            }

            // Failed models have no valid latency data — show '-' instead of
            // the meaningless '0ms' so the row reads as "no valid number".
            const latCell = failed ? '-' : `${this.formatNumber(result.medianLatency)}ms`;
            const avgCell = failed ? '-' : `${this.formatNumber(result.averageLatency)}ms`;
            const minCell = failed ? '-' : `${this.formatNumber(result.minLatency)}ms`;
            const maxCell = failed ? '-' : `${this.formatNumber(result.maxLatency)}ms`;

            tableHTML += `
                <tr>
                    <td><span class="benchmark-rank">${rank}</span></td>
                    <td class="benchmark-model-cell">${this.getDisplayName(result.model)}</td>
                    <td class="${failed ? '' : latencyClass}">${latCell}</td>
                    <td>${avgCell}</td>
                    <td>${minCell}</td>
                    <td>${maxCell}</td>
                    <td class="${successClass}">${result.successRate}%</td>
                    <td>${result.successfulRequests}/${result.totalRequests}</td>
                </tr>
            `;
        });

        tableHTML += `
                    </tbody>
                </table>
            </div>
        `;

        return tableHTML;
    }

    hideModal() {
        if (this.modal) {
            this.modal.classList.add('hidden');
        }
    }

    async benchmarkThinking1Model(apiUrl, apiKey, modelName, testCount = ModelBenchmark.TEST_COUNT, thinkingEnabled = false) {
        console.log(`\n🎯 [Bench 2] Starting thinking-1 (random line) benchmark for model: ${this.getDisplayName(modelName)}`);
        console.log(`   Running ${testCount} parallel test requests...`);

        const results = [];
        const requests = Array.from({ length: testCount }, () =>
            this.performUUIDRequest(apiUrl, apiKey, modelName, thinkingEnabled)
        );

        const requestResults = await Promise.all(requests);

        // Process results and collect successful ones with correct answers
        if (!requestResults || !Array.isArray(requestResults)) {
            console.log(`   ❌ Invalid request results for ${modelName}`);
            return null;
        }

        requestResults.forEach((result, index) => {
            if (!result || typeof result.success !== 'boolean') {
                console.warn(`   ⚠️  Request ${index + 1} has invalid result structure`);
                return;
            }

            if (result.success) {
                results.push({
                    latency: result.latency,
                    correct: result.correct,
                    line: index + 1
                });
                if (!result.correct) {
                    console.warn(`   ⚠️  Request ${index + 1} returned wrong answer`);
                }
            } else {
                console.warn(`   ⚠️  Request ${index + 1} failed: ${result.error}`);
            }
        });

        if (results.length === 0) {
            console.log(`   ❌ No successful requests for ${modelName} (timeout or errors)`);
            const failedResult = {
                model: modelName,
                averageLatency: '0',
                medianLatency: '0',
                minLatency: '0',
                maxLatency: '0',
                successRate: '0.0',
                correctAnswers: 0,
                successfulRequests: 0,
                totalRequests: testCount,
                allLatencies: [],
                note: 'No successful requests (timeout or errors)'
            };
            console.log(`   ❌ FAIL - 0% success rate (<80% threshold)`);
            this.benchResults.thinking1.push(failedResult);
            return failedResult;
        }

        // Drop lowest 2 and highest 2 latencies, use remaining 6
        const trimmedLatencies = this.trimOutliers(results.map(r => r.latency));

        if (trimmedLatencies.length === 0) {
            // Too few successes to survive trimming — not enough data for
            // reliable latency stats. Still register the model as a failed
            // row (it does surface its real success count) rather than
            // silently dropping it from the results.
            console.log(`   ❌ Not enough successful requests for trimmed calculation (${results.length}/${testCount} succeeded)`);
            const failedResult = {
                model: modelName,
                averageLatency: '0',
                medianLatency: '0',
                minLatency: '0',
                maxLatency: '0',
                successRate: '0.0',
                correctAnswers: results.filter(r => r.correct).length,
                successfulRequests: results.length,
                totalRequests: testCount,
                allLatencies: [],
                note: 'Too few successful requests to compute stable stats'
            };
            console.log(`   ❌ FAIL - 0% success rate (<80% threshold)`);
            this.benchResults.thinking1.push(failedResult);
            return failedResult;
        }

        // Calculate stats on trimmed results
        const avgLatency = trimmedLatencies.reduce((a, b) => a + b, 0) / trimmedLatencies.length;
        const minLatency = Math.min(...trimmedLatencies);
        const maxLatency = Math.max(...trimmedLatencies);
        const medianLatency = this.calculateMedian(trimmedLatencies);

        // Count correct answers from all successful requests
        const correctCount = results.filter(r => r.correct).length;
        const successRate = (correctCount / results.length) * 100;

        const result = {
            model: modelName,
            averageLatency: avgLatency.toFixed(2),
            medianLatency: medianLatency.toFixed(2),
            minLatency: minLatency.toFixed(2),
            maxLatency: maxLatency.toFixed(2),
            successRate: successRate.toFixed(1),
            correctAnswers: correctCount,
            successfulRequests: results.length,
            totalRequests: testCount,
            allLatencies: trimmedLatencies.map(l => l.toFixed(2))
        };

        const passed = successRate >= ModelBenchmark.PASS_RATE_THRESHOLD;
        const passStatus = passed ? '✅ PASS' : '❌ FAIL';

        console.log(`   ✅ Complete: ${results.length}/${testCount} successful requests (${correctCount} correct)`);
        console.log(`   ${passStatus} - Success Rate: ${result.successRate}% ${passed ? '(≥80% threshold)' : '(<80% threshold)'}`);
        console.log(`   📊 Statistics (trimmed ${testCount}→${trimmedLatencies}): Median: ${result.medianLatency}ms | Avg: ${result.averageLatency}ms | Min: ${result.minLatency}ms | Max: ${result.maxLatency}ms`);

        this.benchResults.thinking1.push(result);
        return result;
    }

    /**
     * Bench 1 — Response Time: measures raw endpoint latency only.
     * Streams a trivial prompt and records the latency to the FIRST content
     * token (then aborts). No max_tokens cap, no accuracy dimension — success
     * is simply "the model started emitting output within the timeout."
     */
    async benchmarkResponseTimeModel(apiUrl, apiKey, modelName, testCount = ModelBenchmark.PURE_SPEED_TEST_COUNT, thinkingEnabled = false) {
        console.log(`\n⚡ [Bench 1] Starting response-time benchmark for model: ${this.getDisplayName(modelName)}`);
        console.log(`   Running ${testCount} parallel first-token-arrival (streaming) tests...`);

        const results = [];
        const requests = Array.from({ length: testCount }, () =>
            this.performPureSpeedRequest(apiUrl, apiKey, modelName, thinkingEnabled)
        );

        const requestResults = await Promise.all(requests);

        if (!requestResults || !Array.isArray(requestResults)) {
            console.log(`   ❌ Invalid response-time results for ${modelName}`);
            return null;
        }

        requestResults.forEach((result, index) => {
            if (!result || typeof result.success !== 'boolean') {
                console.warn(`   ⚠️  Response-time request ${index + 1} has invalid result structure`);
                return;
            }
            if (result.success) {
                results.push({ latency: result.latency });
            } else {
                console.warn(`   ⚠️  Response-time request ${index + 1} failed: ${result.error}`);
            }
        });

        if (results.length === 0) {
            console.log(`   ❌ No successful response-time requests for ${modelName} (timeout or errors)`);
            const failedResult = {
                model: modelName,
                averageLatency: '0',
                medianLatency: '0',
                minLatency: '0',
                maxLatency: '0',
                successRate: '0.0',
                correctAnswers: 0,
                successfulRequests: 0,
                totalRequests: testCount,
                allLatencies: [],
                note: 'No successful response-time requests (timeout or errors)'
            };
            console.log(`   ❌ FAIL - 0% success rate (<80% threshold)`);
            this.benchResults.responseTime.push(failedResult);
            return failedResult;
        }

        // Drop lowest 2 and highest 2 latencies, use remaining
        const trimmedLatencies = this.trimOutliers(results.map(r => r.latency));

        if (trimmedLatencies.length === 0) {
            // Too few successes to survive trimming — not enough data for
            // reliable latency stats. Still register the model as a failed
            // row (surfacing its real success count) rather than silently
            // dropping it from the results.
            console.log(`   ❌ Not enough successful response-time requests for trimmed calculation (${results.length}/${testCount} succeeded)`);
            const failedResult = {
                model: modelName,
                averageLatency: '0',
                medianLatency: '0',
                minLatency: '0',
                maxLatency: '0',
                successRate: '0.0',
                correctAnswers: 0,
                successfulRequests: results.length,
                totalRequests: testCount,
                allLatencies: [],
                note: 'Too few successful requests to compute stable stats'
            };
            console.log(`   ❌ FAIL - 0% success rate (<80% threshold)`);
            this.benchResults.responseTime.push(failedResult);
            return failedResult;
        }

        const avgLatency = trimmedLatencies.reduce((a, b) => a + b, 0) / trimmedLatencies.length;
        const minLatency = Math.min(...trimmedLatencies);
        const maxLatency = Math.max(...trimmedLatencies);
        const medianLatency = this.calculateMedian(trimmedLatencies);

        // Success rate = successful (non-error) requests / total requests
        const successRate = (results.length / testCount) * 100;

        const result = {
            model: modelName,
            averageLatency: avgLatency.toFixed(2),
            medianLatency: medianLatency.toFixed(2),
            minLatency: minLatency.toFixed(2),
            maxLatency: maxLatency.toFixed(2),
            successRate: successRate.toFixed(1),
            successfulRequests: results.length,
            totalRequests: testCount,
            allLatencies: trimmedLatencies.map(l => l.toFixed(2))
        };

        console.log(`   ✅ [Bench 1] Response-time complete: ${results.length}/${testCount} successful — Median: ${result.medianLatency}ms | Avg: ${result.averageLatency}ms`);

        this.benchResults.responseTime.push(result);
        return result;
    }

    /**
     * Bench 1 response-time probe. All we measure is endpoint responsiveness:
     * does the model start producing output within the timeout? We stream the
     * response (stream: true, no max_tokens cap) and stop the instant the
     * first non-empty content token arrives — that timestamp is the latency.
     * The stream is then aborted so the model doesn't keep generating.
     *
     * Success = at least one content delta came back. Failure = non-200 HTTP,
     * a network/parse error, timeout, or the stream ended with no content.
     */
    async performPureSpeedRequest(apiUrl, apiKey, modelName, thinkingEnabled = false) {
        const systemPrompt = `You are a test endpoint.`;
        const userPrompt = ModelBenchmark.PURE_SPEED_PROMPT;

        const abortController = new AbortController();
        const timeoutId = setTimeout(
            () => abortController.abort(),
            ModelBenchmark.TIMEOUT_MS
        );

        const startTime = performance.now();

        try {
            const response = await fetch(`${apiUrl}chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                signal: abortController.signal,
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.1,
                    stream: true,
                    chat_template_kwargs: { enable_thinking: thinkingEnabled }
                })
            });

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                return {
                    success: false,
                    latency: null,
                    error: `HTTP ${response.status}${text ? `: ${text.slice(0, 120)}` : ''}`
                };
            }

            // Walk the SSE stream until the first non-empty content delta.
            if (!response.body) {
                return { success: false, latency: null, error: 'No response body to stream' };
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                // SSE events are separated by blank lines; process whole ones.
                let nl;
                while ((nl = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, nl).trim();
                    buffer = buffer.slice(nl + 1);
                    const found = ModelBenchmark._firstContentToken(line);
                    if (found === 'done') { buffer = ''; break; }
                    if (found) {
                        return { success: true, latency: performance.now() - startTime, error: null };
                    }
                }
            }

            // Final flush: the last SSE line may have no trailing newline
            // (server closed the connection mid-line). Drain the decoder and
            // check the residual buffer before declaring no token.
            buffer += decoder.decode();
            if (buffer.trim()) {
                const found = ModelBenchmark._firstContentToken(buffer.trim());
                if (found === true) {
                    return { success: true, latency: performance.now() - startTime, error: null };
                }
            }

            // Stream ended without any content token.
            return { success: false, latency: null, error: 'No content token in stream' };
        } catch (error) {
            const timedOut = error.name === 'AbortError' && performance.now() - startTime >= ModelBenchmark.TIMEOUT_MS * 0.98;
            return {
                success: false,
                latency: null,
                error: timedOut
                    ? `Request timeout after ${ModelBenchmark.TIMEOUT_MS / 1000} seconds`
                    : (error.message || 'Request failed or timed out')
            };
        } finally {
            clearTimeout(timeoutId);
            // Ensure the underlying fetch/stream is torn down even if we
            // returned early on the first token.
            abortController.abort();
        }
    }

    /**
     * Inspect one SSE `data:` line for the pure-speed probe. Returns:
     *   true  — line carries a non-empty content delta (a usable token)
     *   'done' — the terminal [DONE] sentinel
     *   false — anything else (comment, blank, unparseable, no content)
     * Used for both the streaming loop and the final no-trailing-newline flush.
     */
    static _firstContentToken(line) {
        if (typeof line !== 'string') return false;
        line = line.trim();
        if (!line.startsWith('data:')) return false;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return 'done';
        let chunk;
        try { chunk = JSON.parse(payload); }
        catch { return false; }
        const delta = chunk?.choices?.[0]?.delta?.content;
        return typeof delta === 'string' && delta.length > 0;
    }

    async performUUIDRequest(apiUrl, apiKey, modelName, thinkingEnabled = false) {
        try {
            // Fallback for crypto.randomUUID() in older browsers
            const generateUUID = () => {
                if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                    return crypto.randomUUID();
                }
                // Fallback implementation
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    const r = Math.random() * 16 | 0;
                    const v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            };

            // Generate 20 random UUID strings
            const uuids = Array.from({ length: ModelBenchmark.NUM_UUIDS }, () => generateUUID());
            const targetLine = Math.floor(Math.random() * 10) + 5; // Random line between 5-14

            const systemPrompt = `You are a helpful assistant. I will give you 20 lines, each containing a random string. Your task is to return ONLY the string on line ${targetLine}. Do not include any other text, explanation, or line numbers - just the exact string on that line.`;

            // Build the UUID list as numbered lines
            const uuidList = uuids.map((uuid, i) => `${i + 1}. ${uuid}`).join('\n');
            const userPrompt = `Here are the strings:\n\n${uuidList}\n\nReturn the string on line ${targetLine}:`;

            const startTime = performance.now();

            // Create a timeout promise that resolves after timeout
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`Request timeout after ${ModelBenchmark.TIMEOUT_MS/1000} seconds`)), ModelBenchmark.TIMEOUT_MS);
            });

            // Race between the actual fetch and the timeout
            try {
                const response = await Promise.race([
                    fetch(`${apiUrl}chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: modelName,
                            messages: [
                                { role: 'system', content: systemPrompt },
                                { role: 'user', content: userPrompt }
                            ],
                            temperature: 0.1,
                            // Respect the UI "Model Reasoning" toggle so speed
                            // tests can compare thinking on vs off.
                            chat_template_kwargs: {
                                enable_thinking: thinkingEnabled
                            }
                        })
                    }),
                    timeoutPromise
                ]);

                const endTime = performance.now();
                const latency = endTime - startTime;

                // Validate response structure (it could be from timeout)
                if (!response || typeof response.ok !== 'boolean') {
                    throw new Error('Invalid response after timeout');
                }

                if (!response.ok) {
                    return {
                        success: false,
                        latency: latency,
                        correct: false,
                        error: `HTTP ${response.status}`
                    };
                }

                const data = await response.json();
                const modelResponse = data.choices?.[0]?.message?.content?.trim() || '';

                // Check if the response matches the target UUID
                const targetUUID = uuids[targetLine - 1];
                const correct = modelResponse === targetUUID;

                return {
                    success: true,
                    latency: latency,
                    correct: correct,
                    targetLine: targetLine
                };
            } catch (raceError) {
                // Handle Promise.race errors
                return {
                    success: false,
                    latency: null,
                    correct: false,
                    error: raceError.message || 'Request failed or timed out'
                };
            }
        } catch (error) {
            return {
                success: false,
                latency: null,
                correct: false,
                error: error.message
            };
        }
    }

    calculateMedian(latencies) {
        if (latencies.length === 0) return 0;

        const sorted = [...latencies].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);

        if (sorted.length % 2 === 0) {
            return (sorted[middle - 1] + sorted[middle]) / 2;
        } else {
            return sorted[middle];
        }
    }

    formatNumber(num, decimals = 0) {
        return Number(num).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    trimOutliers(latencies) {
        // Filter out null/undefined latencies first
        const validLatencies = latencies.filter(l => l !== null && !isNaN(l));

        if (validLatencies.length === 0) {
            return [];
        }

        // Sort and trim outliers
        return validLatencies.sort((a, b) => a - b)
            .slice(ModelBenchmark.TRIM_LOW_COUNT, validLatencies.length - ModelBenchmark.TRIM_HIGH_COUNT);
    }

    printResults() {
        console.log('\n📊 BENCHMARK RESULTS');
        console.log('='.repeat(130));

        const any = ModelBenchmark.BENCHMARKS.some(b => (this.benchResults[b.id] || []).length > 0);
        if (!any) {
            console.log('No benchmark results available.');
            return;
        }

        // Print each benchmark's table, driven by the registry.
        ModelBenchmark.BENCHMARKS.forEach(b => {
            this._printResultTable(`${b.consoleBanner}`, this.benchResults[b.id] || []);
            console.log('\n' + '='.repeat(130));
        });
    }

    _printResultTable(title, results) {
        console.log(`\n${title}`);
        console.log('─'.repeat(130));

        if (results.length === 0) {
            console.log('No results available.');
            return;
        }

        // Split into pass/fail on the 80% success-rate threshold
        const passedResults = results.filter(r => parseFloat(r.successRate) >= ModelBenchmark.PASS_RATE_THRESHOLD);
        const failedResults = results.filter(r => parseFloat(r.successRate) < ModelBenchmark.PASS_RATE_THRESHOLD);

        const sortedPassed = [...passedResults].sort((a, b) =>
            parseFloat(a.medianLatency) - parseFloat(b.medianLatency)
        );
        const sortedFailed = [...failedResults].sort((a, b) =>
            parseFloat(b.successRate) - parseFloat(a.successRate)
        );
        const sortedResults = [...sortedPassed, ...sortedFailed];

        console.log('\n🏆 MODEL PERFORMANCE RANKING (≥80% Pass Rate by Speed, Below 80% by Accuracy)');
        console.log('─'.repeat(130));

        const header = ['Rank', 'Model', 'Median', 'Avg', 'Min', 'Max', 'Success Rate', 'Requests'];
        const colWidths = [6, 40, 12, 12, 10, 10, 15, 12];

        console.log(
            header.map((h, i) => h.padEnd(colWidths[i])).join('|').trim()
        );
        console.log('─'.repeat(130).replace(/─/g, '─'));

        sortedResults.forEach((result, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
            const rank = `${medal} ${index + 1}`;
            const displayName = this.getDisplayName(result.model);
            const model = displayName.length > 37 ? displayName.substring(0, 37) + '...' : displayName;
            const median = `${this.formatNumber(result.medianLatency)}ms`;
            const avg = `${this.formatNumber(result.averageLatency)}ms`;
            const min = `${this.formatNumber(result.minLatency)}ms`;
            const max = `${this.formatNumber(result.maxLatency)}ms`;
            const success = `${result.successRate}%`;
            const requests = `${result.successfulRequests}/${result.totalRequests}`;

            console.log(
                rank.padEnd(colWidths[0]) +
                model.padEnd(colWidths[1]) +
                median.padEnd(colWidths[2]) +
                avg.padEnd(colWidths[3]) +
                min.padEnd(colWidths[4]) +
                max.padEnd(colWidths[5]) +
                success.padEnd(colWidths[6]) +
                requests.padEnd(colWidths[7])
            );
        });

        console.log('\n📋 DETAILED RESULTS');
        console.log('─'.repeat(130));

        results.forEach((result, index) => {
            console.log(`\n${index + 1}. Model: ${this.getDisplayName(result.model)}`);
            console.log(`   Median Latency: ${this.formatNumber(result.medianLatency)}ms`);
            console.log(`   Average Latency: ${this.formatNumber(result.averageLatency)}ms`);
            console.log(`   Min Latency: ${this.formatNumber(result.minLatency)}ms`);
            console.log(`   Max Latency: ${this.formatNumber(result.maxLatency)}ms`);
            console.log(`   Success Rate: ${result.successRate}% (${result.successfulRequests}/${result.totalRequests})`);
            if (result.allLatencies) {
                console.log(`   All Latencies: [${result.allLatencies.map(l => this.formatNumber(l)).join(', ')}]ms`);
            }
        });
    }

    clearResults() {
        ModelBenchmark.BENCHMARKS.forEach(b => { this.benchResults[b.id] = []; });
        this.sortState = {}; // reset user-applied sort when a new run starts
        this.updateSortButtonState();
        console.log('🧹 Benchmark results cleared.');
    }

    startBenchmarkTimer() {
        const benchmarkBtn = document.getElementById('benchmark-btn');
        if (!benchmarkBtn) return;

        this.benchmarkStartTime = Date.now();
        this.benchmarkElapsedTime = 0;

        this.benchmarkTimer = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - this.benchmarkStartTime) / 1000);
            this.benchmarkElapsedTime = elapsedSeconds;
            benchmarkBtn.textContent = `⏳ Running benchmarks (${elapsedSeconds}s)`;
        }, 1000);
    }
}

// Global benchmark instance
const benchmark = new ModelBenchmark();

// Benchmark button functionality
document.addEventListener('DOMContentLoaded', () => {
    const benchmarkBtn = document.getElementById('benchmark-btn');

    if (benchmarkBtn) {
        benchmarkBtn.addEventListener('click', async () => {
            // Disable button immediately
            benchmarkBtn.disabled = true;

            const apiUrl = document.getElementById('api-url').value;
            const apiKey = document.getElementById('api-key').value;
            // Mirror the Options toggle so benchmarks compare the same setting used in-game
            const thinkingEnabled = document.getElementById('thinking-mode-checkbox')?.checked ?? false;

            if (!apiUrl || !apiKey) {
                console.error('❌ Please provide API URL and API key');
                alert('Please provide API URL and API key');
                benchmarkBtn.disabled = false;
                return;
            }

            // Access availableModels from game.js
            if (typeof availableModels === 'undefined' || availableModels.length === 0) {
                console.error('❌ No models loaded. Please load models first.');
                alert('Please load models first by clicking "Load Models"');
                benchmarkBtn.disabled = false;
                return;
            }

            benchmark.startBenchmarkTimer();
            benchmark.clearResults();
            // Ensure sort by speed and show results buttons are initially disabled during benchmark
            if (benchmark.sortBySpeedBtn) {
                benchmark.sortBySpeedBtn.classList.add('btn-disabled');
            }
            if (benchmark.showResultsBtn) {
                benchmark.showResultsBtn.classList.add('btn-disabled');
            }

            const benches = ModelBenchmark.BENCHMARKS;
            console.log(`\n🚀 Starting benchmark suite for ALL loaded models (${benches.length} benchmarks)`);
            console.log(`   Found ${availableModels.length} models to benchmark`);

            try {
                // Run each benchmark in registry order. Each phase fans out one
                // runner call per model in parallel. To add a benchmark, append
                // to ModelBenchmark.BENCHMARKS and add a runner method.
                for (let i = 0; i < benches.length; i++) {
                    const b = benches[i];
                    console.log(`\n▶️ Phase ${i + 1}/${benches.length} — ${b.consoleBanner}`);
                    const runner = benchmark[b.runner];
                    if (typeof runner !== 'function') {
                        console.warn(`   ⚠️  No runner method "${b.runner}" for benchmark "${b.id}" — skipping`);
                        continue;
                    }
                    await Promise.allSettled(availableModels.map(model =>
                        // Count omitted so each runner applies its own default
                        runner.call(benchmark, apiUrl, apiKey, model.id, undefined, thinkingEnabled)
                    ));
                }

                benchmark.printResults();
                // Enable sort by speed button only after benchmark completes
                benchmark.updateSortButtonState();
                // Automatically show results popup after benchmark completes
                benchmark.showResultsInModal();
            } catch (error) {
                console.error('❌ Benchmark error:', error);
            } finally {
                benchmark.stopBenchmarkTimer();
                benchmarkBtn.disabled = false;
                benchmarkBtn.textContent = '⚡ Run Benchmarks';
            }
        });
    }
});