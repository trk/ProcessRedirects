/**
 * ProcessRedirects Admin Scripts
 *
 * Provides smart URL normalization, live status code guidance, client-side table search,
 * master select-all toggle, and infinite redirect loop detection.
 */
(function($, ProcessWire) {
	'use strict';

	$(function() {

		// Read localized settings & translations passed from ProcessRedirects.module via $config->js()
		const jsConfig = (ProcessWire && ProcessWire.config && ProcessWire.config.ProcessRedirects) || {};
		const labels = jsConfig.labels || {};
		const localizedCodeDescriptions = jsConfig.codeDescriptions || {};

		// =========================================================================
		// 1. EDIT / ADD FORM: Smart URL Normalization & Validation
		// =========================================================================
		const $fromInput = $('#redirect_from');
		const $toInput = $('#redirect_to');
		const $pageSelect = $('#select_page');
		const $codeSelect = $('#redirect_code');
		const $editForm = $('#ProcessRedirectsEditForm');

		if ($fromInput.length) {

			/**
			 * Normalize Redirect From path on blur:
			 * - Trims whitespace
			 * - Automatically extracts relative pathname if user pasted a full URL
			 * - Enforces leading slash
			 * - Safely encodes spaces to %20 without corrupting other UTF-8 chars
			 */
			$fromInput.on('blur', function() {
				let val = $(this).val().trim();
				if (!val) return;

				// If full URL was pasted, parse pathname + search
				try {
					if (/^https?:\/\//i.test(val)) {
						const urlObj = new URL(val, window.location.origin);
						val = urlObj.pathname + urlObj.search;
					}
				} catch (e) {
					// Fallback if URL parsing fails
				}

				// Normalize leading slashes
				val = '/' + val.replace(/^\/+/, '');

				// Safely encode all whitespace to %20
				val = val.replace(/\s+/g, '%20');

				$(this).val(val);
			});
		}

		let selectedPageUrl = $pageSelect.attr('data-url') || '';
		if ($pageSelect.length) {
			// Track selected internal page URL for loop prevention and external field sync
			$pageSelect.on('pageSelected', function(event, data) {
				if (data && data.url && data.url.length) {
					selectedPageUrl = data.url;
					if (!$toInput.val() || $('input[name="target_type"]:checked').val() === 'internal') {
						$toInput.val(data.url);
					}
				}
			});

			$('input[name="target_type"]').on('change', function() {
				if ($(this).val() === 'external' && !$toInput.val() && selectedPageUrl) {
					$toInput.val(selectedPageUrl);
				}
			});
		}

		if ($codeSelect.length) {

			// Default HTTP Status code explanations (fallback if translations not loaded)
			const defaultCodeDescriptions = {
				301: {
					type: 'success',
					text: '301 Moved Permanently: Best for permanent SEO changes. Fully cached by browsers and search engines; passes link equity.'
				},
				302: {
					type: 'warning',
					text: '302 Found (Temporary): Standard temporary redirect. Search engines maintain the original URL in the index.'
				},
				303: {
					type: 'primary',
					text: '303 See Other: Directs client to target using HTTP GET method. Ideal for Post/Redirect/Get patterns.'
				},
				307: {
					type: 'warning',
					text: '307 Temporary Redirect: Modern temporary redirect strictly preserving HTTP request method (POST remains POST).'
				},
				308: {
					type: 'success',
					text: '308 Permanent Redirect: Modern permanent redirect strictly preserving HTTP request method and caching behavior.'
				}
			};

			// Merge server-provided localized explanations over defaults
			const codeDescriptions = $.extend(true, {}, defaultCodeDescriptions, localizedCodeDescriptions);

			const $helpContainer = $('<div id="redirect_code_help" class="uk-margin-small-top uk-text-small"></div>');
			$codeSelect.after($helpContainer);


			function updateCodeHelp() {
				const selectedCode = parseInt($codeSelect.val(), 10);
				const info = codeDescriptions[selectedCode];
				if (info) {
					$helpContainer.empty();
					$helpContainer.append($('<i class="fa fa-info-circle uk-margin-small-right" aria-hidden="true"></i>'));
					$helpContainer.append(document.createTextNode(info.text));
				} else {
					$helpContainer.empty();
				}
			}

			$codeSelect.on('change', updateCodeHelp);
			updateCodeHelp();
		}

		if ($editForm.length) {

			/**
			 * Validate form values and prevent infinite loops before submit
			 */
			$editForm.on('submit', function(event) {
				const targetType = $('input[name="target_type"]:checked').val() || 'internal';
				const toVal = $toInput.val().trim();
				const pageVal = $pageSelect.val() ? $pageSelect.val().trim() : '';

				// Ensure target destination is provided based on destination type
				if (targetType === 'internal') {
					if (!pageVal || pageVal === '0') {
						event.preventDefault();
						const alertMsg = labels.noRedirectTo || $editForm.attr('data-no-redirect-to') || 'Please select target page.';
						if (ProcessWire && ProcessWire.alert) {
							ProcessWire.alert(alertMsg);
						} else {
							alert(alertMsg);
						}
						if (typeof Inputfields === 'object' && Inputfields.highlight) {
							Inputfields.highlight('select_page');
						}
						return false;
					}
				} else {
					if (toVal === '') {
						event.preventDefault();
						const alertMsg = labels.noTargetUrl || $editForm.attr('data-no-target-url') || 'Please enter target URL.';
						if (ProcessWire && ProcessWire.alert) {
							ProcessWire.alert(alertMsg);
						} else {
							alert(alertMsg);
						}
						$toInput.focus();
						return false;
					}
				}

				// Prevent infinite redirect loops (Redirect From === Redirect To)
				let fromNorm = $fromInput.val().trim().replace(/\/+$/, '');
				let targetNorm = targetType === 'internal' ? (selectedPageUrl || '') : toVal;

				try {
					if (/^https?:\/\//i.test(targetNorm)) {
						const urlObj = new URL(targetNorm, window.location.origin);
						if (urlObj.origin === window.location.origin) {
							targetNorm = urlObj.pathname + urlObj.search;
						}
					}
				} catch (e) {}

				targetNorm = targetNorm.replace(/\/+$/, '');

				if (fromNorm && targetNorm && fromNorm === targetNorm) {
					event.preventDefault();
					const loopMsg = labels.loopError || $editForm.attr('data-loop-error') || 'Redirect From and Redirect To cannot be identical (would cause an infinite redirect loop).';
					if (ProcessWire && ProcessWire.alert) {
						ProcessWire.alert(loopMsg);
					} else {
						alert(loopMsg);
					}
					if (targetType === 'external') {
						$toInput.focus();
					}
					return false;
				}
			});
		}

		// =========================================================================
		// 2. ADMIN TABLE: Instant Search, Select-All, and Bulk Delete
		// =========================================================================
		const $redirectsForm = $('#redirects_form');
		const $searchInput = $('#redirects_table_search');
		const $searchCount = $('#redirects_search_count');
		const $selectAll = $('#select_all_redirects');

		if ($redirectsForm.length) {

			const $table = $redirectsForm.find('table.AdminDataTable, table.uk-table').first();
			const $rows = $table.find('tbody tr');
			const totalRows = $rows.length;

			// --- A. Instant Client-Side Table Search ---
			if ($searchInput.length && $rows.length) {

				let searchTimeout = null;

				function filterTable() {
					const query = $searchInput.val().trim().toLowerCase();
					let visibleCount = 0;

					if (!query) {
						$rows.show();
						$searchCount.hide().text('');
						$table.find('.redirects-no-results').remove();
						updateSelectAllState();
						return;
					}

					$rows.each(function() {
						const $row = $(this);
						// Search text across all cells in the row
						const rowText = $row.text().toLowerCase();
						const matches = rowText.indexOf(query) !== -1;
						if (matches) {
							$row.show();
							visibleCount++;
						} else {
							$row.hide();
						}
					});

					// Manage "No matching redirects found" row
					$table.find('.redirects-no-results').remove();
					if (visibleCount === 0) {
						const colSpan = $table.find('thead th').length || 7;
						const noResultsMsg = labels.noResults || 'No redirects matching your search.';
						const $noResultsRow = $('<tr class="redirects-no-results"><td class="uk-text-center uk-text-muted" style="padding: 24px;"></td></tr>');
						$noResultsRow.find('td').attr('colspan', colSpan).text(noResultsMsg);
						$table.find('tbody').append($noResultsRow);
					}

					$searchCount.text(visibleCount + ' / ' + totalRows).show();
					updateSelectAllState();
				}

				$searchInput.on('input', function() {
					clearTimeout(searchTimeout);
					searchTimeout = setTimeout(filterTable, 100);
				});

				// Escape key clears search
				$searchInput.on('keydown', function(e) {
					if (e.key === 'Escape') {
						$(this).val('');
						filterTable();
					}
				});
			}

			// --- B. Master "Select All" Toggle ---
			function getCheckboxes() {
				return $rows.filter(':visible').find('input[name="delete[]"]');
			}

			function updateSelectAllState() {
				if (!$selectAll.length) return;
				const $visibleCheckboxes = getCheckboxes();
				const totalVisible = $visibleCheckboxes.length;
				const checkedVisible = $visibleCheckboxes.filter(':checked').length;

				if (totalVisible === 0 || checkedVisible === 0) {
					$selectAll.prop('checked', false);
					$selectAll.prop('indeterminate', false);
				} else if (checkedVisible === totalVisible) {
					$selectAll.prop('checked', true);
					$selectAll.prop('indeterminate', false);
				} else {
					$selectAll.prop('checked', false);
					$selectAll.prop('indeterminate', true);
				}
			}

			if ($selectAll.length) {
				$selectAll.on('change', function() {
					const isChecked = $(this).is(':checked');
					const $visibleCheckboxes = getCheckboxes();

					$visibleCheckboxes.prop('checked', isChecked).trigger('change');
				});

				$redirectsForm.on('change', 'input[name="delete[]"]', function() {
					const $row = $(this).closest('tr');
					$row.toggleClass('row-selected-for-delete', $(this).is(':checked'));
					updateSelectAllState();
				});

			}

			// --- C. Bulk Delete Confirmation ---
			let deleteConfirmed = false;
			$redirectsForm.on('submit', function(event) {
				if (deleteConfirmed) return;

				const $checked = $redirectsForm.find('input[name="delete[]"]:checked');
				if (!$checked.length) {
					event.preventDefault();
					const alertMsg = labels.alertSelect || $redirectsForm.attr('data-alert-select') || 'You need to select at least one item to delete first.';
					if (ProcessWire && ProcessWire.alert) {
						ProcessWire.alert(alertMsg);
					} else {
						alert(alertMsg);
					}
					return;
				}

				event.preventDefault();
				const confirmMsg = labels.confirmDelete || $redirectsForm.attr('data-confirm-delete') || 'Are you sure you want to delete selected redirects?';

				if (ProcessWire && ProcessWire.confirm) {
					ProcessWire.confirm(confirmMsg, function() {
						deleteConfirmed = true;
						$redirectsForm.trigger('submit');
					});
				} else if (window.confirm(confirmMsg)) {
					deleteConfirmed = true;
					$redirectsForm.trigger('submit');
				}
			});
		}

	});
})(jQuery, window.ProcessWire || {});
