// Javascript Logic for Labs Provisioning Portal

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements - Configurations
    const suffixDomainEl = document.getElementById('suffix-domain');

    // DOM Elements - Form & Submission
    const provisionForm = document.getElementById('provision-form');
    const fullNameInput = document.getElementById('full-name');
    const usernameInput = document.getElementById('username');
    const submitBtn = document.getElementById('submit-btn');
    const processingState = document.getElementById('processing-state');
    const processingStep = document.getElementById('processing-step');
    const formErrorAlert = document.getElementById('form-error-alert');
    const errorDesc = document.getElementById('error-desc');

    // DOM Elements - Errors
    const nameError = document.getElementById('name-error');
    const usernameError = document.getElementById('username-error');

    // DOM Elements - Results
    const resultsCard = document.getElementById('results-card');
    const formCard = document.querySelector('.form-card');
    const resultEmail = document.getElementById('result-email');
    const resultPassword = document.getElementById('result-password');
    const btnTogglePassword = document.getElementById('btn-toggle-password');
    const consoleLink = document.getElementById('console-link');
    const btnProvisionAnother = document.getElementById('btn-provision-another');

    // Clipboard Status Toast
    const copyToast = document.getElementById('copy-toast');

    // DOM Elements - Provisioned Accounts List
    const searchUsersInput = document.getElementById('search-users');
    const usersTableContainer = document.getElementById('users-table-container');
    const usersListBody = document.getElementById('users-list-body');
    const usersEmptyState = document.getElementById('users-empty-state');
    const emptyStateText = document.getElementById('empty-state-text');

    // State Variables
    let isUsernameModifiedManually = false;
    let currentConfig = { projectId: 'loading...', domain: 'domain.com' };
    let realRawPassword = ''; // Stores the clear password for visibility toggle

    // Generate/Retrieve unique Client ID for original creator validation
    let clientId = localStorage.getItem('labs_client_id');
    if (!clientId) {
        clientId = 'client_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
        localStorage.setItem('labs_client_id', clientId);
    }

    // 1. Fetch Configuration on Startup
    async function fetchConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('Failed to fetch configuration');
            
            currentConfig = await response.json();
            
            // Render Config in UI
            suffixDomainEl.textContent = currentConfig.domain;
        } catch (error) {
            console.error('Error fetching config:', error);
            suffixDomainEl.textContent = 'domain.com';
        }
    }

    // 2. Auto-derive Username from Name
    fullNameInput.addEventListener('input', (e) => {
        if (isUsernameModifiedManually) return;

        const nameValue = e.target.value;
        if (!nameValue) {
            usernameInput.value = '';
            return;
        }

        // Generate username: lowercase, replace spaces/special chars with dots
        let derived = nameValue.toLowerCase()
            .replace(/[^a-z0-9 ]/g, '') // remove special characters
            .trim()
            .replace(/\s+/g, '.'); // replace spaces with dots

        usernameInput.value = derived;
    });

    usernameInput.addEventListener('input', () => {
        isUsernameModifiedManually = true;
        // Clean username input on-the-fly to allow only valid characters (lowercase, digits, dots)
        const val = usernameInput.value;
        const cleaned = val.toLowerCase().replace(/[^a-z0-9.]/g, '');
        if (val !== cleaned) {
            usernameInput.value = cleaned;
        }
    });

    // Reset automatic derivation flag on empty input
    fullNameInput.addEventListener('change', () => {
        if (fullNameInput.value.trim() === '' && usernameInput.value.trim() === '') {
            isUsernameModifiedManually = false;
        }
    });

    // 3. Form Submission & Client-side Validation
    provisionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Hide previous errors
        formErrorAlert.classList.add('hidden');
        nameError.style.display = 'none';
        usernameError.style.display = 'none';
        fullNameInput.classList.remove('invalid');
        usernameInput.classList.remove('invalid');

        const nameValue = fullNameInput.value.trim();
        const usernameValue = usernameInput.value.trim();

        let hasError = false;

        if (!nameValue) {
            nameError.style.display = 'block';
            fullNameInput.classList.add('invalid');
            hasError = true;
        }

        if (!usernameValue) {
            usernameError.style.display = 'block';
            usernameInput.classList.add('invalid');
            hasError = true;
        } else if (!/^[a-z0-9.]+$/.test(usernameValue)) {
            usernameError.textContent = 'Username must contain only lowercase letters, digits, and single dots.';
            usernameError.style.display = 'block';
            usernameInput.classList.add('invalid');
            hasError = true;
        }

        if (hasError) return;

        // Start loading flow
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
        fullNameInput.disabled = true;
        usernameInput.disabled = true;
        processingState.classList.remove('hidden');

        // Linear step text sequence simulations to provide a highly premium feel
        const steps = [
            'Initializing secure connection...',
            'Validating credentials and active domains...',
            'Creating user account in Cloud Identity...',
            'Configuring user profiles...',
            'Retrieving Google Cloud project IAM policies...',
            'Granting roles/apigee.admin role to user...',
            'Verifying setup and finishing up...'
        ];
        
        let stepIdx = 0;
        processingStep.textContent = steps[stepIdx];
        
        const stepInterval = setInterval(() => {
            if (stepIdx < steps.length - 1) {
                stepIdx++;
                processingStep.textContent = steps[stepIdx];
            }
        }, 1200);

        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: nameValue,
                    username: usernameValue,
                    clientId: clientId
                })
            });

            clearInterval(stepInterval);

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Server returned an error');
            }

            // Save new user info locally in browser storage
            const newUserRecord = {
                name: nameValue,
                username: usernameValue,
                email: result.email,
                createdAt: new Date().toISOString(),
                projectId: result.projectId || currentConfig.projectId
            };

            const currentUsers = getStoredAccounts();
            // Dedup username if existing
            const filteredUsers = currentUsers.filter(u => u.username !== usernameValue);
            filteredUsers.unshift(newUserRecord);
            saveStoredAccounts(filteredUsers);

            // Handle Success
            showSuccessState(result);
            fetchAndRenderAccounts();

        } catch (err) {
            clearInterval(stepInterval);
            console.error('Provisioning error:', err);
            
            // Show error message
            errorDesc.textContent = err.message || 'An unexpected server error occurred. Please try again.';
            formErrorAlert.classList.remove('hidden');
            
            // Re-enable form
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
            fullNameInput.disabled = false;
            usernameInput.disabled = false;
            processingState.classList.add('hidden');
        }
    });

    // 4. Render Success Results Card
    function showSuccessState(data) {
        // Record raw password for toggle
        realRawPassword = data.initialPassword;

        // Display password in clear text initially
        resultPassword.textContent = realRawPassword;
        resultPassword.classList.remove('obfuscated');
        
        const svgEye = btnTogglePassword.querySelector('svg');
        // Set eye icon to 'eye-off' (representing visible password, with line through eye)
        svgEye.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.45 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
        `;
        btnTogglePassword.setAttribute('aria-pressed', 'true');

        // Fill data in results card
        document.getElementById('result-project').textContent = data.projectId;
        resultEmail.textContent = data.email;
        consoleLink.href = data.consoleUrl;

        // Hide form card, show results
        formCard.classList.add('hidden');
        resultsCard.classList.remove('hidden');
    }

    // 5. Toggle Password Hide/Show
    btnTogglePassword.addEventListener('click', () => {
        const isCurrentlyObfuscated = resultPassword.classList.contains('obfuscated');
        const svgEye = btnTogglePassword.querySelector('svg');

        if (isCurrentlyObfuscated) {
            // Show Password
            resultPassword.textContent = realRawPassword;
            resultPassword.classList.remove('obfuscated');
            
            // Change Eye to Eye-Off
            svgEye.innerHTML = `
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.45 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            `;
            btnTogglePassword.setAttribute('aria-pressed', 'true');
        } else {
            // Hide Password
            resultPassword.textContent = '••••••••••••••••';
            resultPassword.classList.add('obfuscated');
            
            // Change Eye-Off to Eye
            svgEye.innerHTML = `
                <path d="M1 12s4-8 11-8 4 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            `;
            btnTogglePassword.setAttribute('aria-pressed', 'false');
        }
    });

    // 6. Copy to Clipboard Implementation
    const copyButtons = document.querySelectorAll('.btn-copy');
    copyButtons.forEach(button => {
        button.addEventListener('click', async () => {
            const targetId = button.getAttribute('data-target');
            let textToCopy = '';

            if (targetId === 'result-password') {
                textToCopy = realRawPassword;
            } else {
                const targetEl = document.getElementById(targetId);
                textToCopy = targetEl.textContent;
            }

            try {
                await navigator.clipboard.writeText(textToCopy);
                showToastMessage('Copied to clipboard!');
            } catch (err) {
                console.error('Failed to copy text:', err);
                
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = textToCopy;
                textArea.style.position = 'fixed'; // prevent scroll to bottom
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    document.execCommand('copy');
                    showToastMessage('Copied to clipboard!');
                } catch (e) {
                    console.error('Fallback copy failed', e);
                }
                document.body.removeChild(textArea);
            }
        });
    });

    function showToastMessage(msg) {
        copyToast.textContent = msg;
        copyToast.classList.add('show');
        copyToast.classList.remove('hidden');
        setTimeout(() => {
            copyToast.classList.remove('show');
            setTimeout(() => {
                copyToast.classList.add('hidden');
            }, 400);
        }, 2000);
    }

    // 7. Provision Another User Handler
    btnProvisionAnother.addEventListener('click', () => {
        // Reset form inputs
        fullNameInput.value = '';
        usernameInput.value = '';
        isUsernameModifiedManually = false;

        // Re-enable form elements
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        fullNameInput.disabled = false;
        usernameInput.disabled = false;
        processingState.classList.add('hidden');

        // Hide results card, show form
        resultsCard.classList.add('hidden');
        formCard.classList.remove('hidden');
    });

    // 8. Provisioned Accounts List, Search, and Deletion Logic
    let provisionedUsers = [];

    function getStoredAccounts() {
        try {
            const stored = localStorage.getItem('labs_provisioned_users');
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.error('Failed to parse labs_provisioned_users from localStorage', e);
            return [];
        }
    }

    function saveStoredAccounts(accounts) {
        try {
            localStorage.setItem('labs_provisioned_users', JSON.stringify(accounts));
        } catch (e) {
            console.error('Failed to save labs_provisioned_users to localStorage', e);
        }
    }

    function fetchAndRenderAccounts() {
        provisionedUsers = getStoredAccounts();
        
        const query = searchUsersInput.value.toLowerCase().trim();
        if (query === '') {
            renderAccounts(provisionedUsers);
        } else {
            const filtered = provisionedUsers.filter(u => 
                u.name.toLowerCase().includes(query) || 
                u.username.toLowerCase().includes(query) || 
                u.email.toLowerCase().includes(query)
            );
            renderAccounts(filtered);
        }
    }

    function renderAccounts(usersToRender) {
        usersListBody.innerHTML = '';
        
        if (usersToRender.length === 0) {
            usersTableContainer.classList.add('hidden');
            usersEmptyState.classList.remove('hidden');
            
            if (searchUsersInput.value.trim() !== '') {
                emptyStateText.textContent = `No users matched "${searchUsersInput.value.trim()}".`;
            } else {
                emptyStateText.textContent = "You haven't provisioned any accounts from this browser yet.";
            }
            return;
        }

        usersTableContainer.classList.remove('hidden');
        usersEmptyState.classList.add('hidden');

        usersToRender.forEach(user => {
            const row = document.createElement('tr');
            row.setAttribute('data-username', user.username);

            // Format date nicely
            const createdDate = new Date(user.createdAt);
            const dateStr = createdDate.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            const projectToDisplay = user.projectId || currentConfig.projectId;

            row.innerHTML = `
                <td>
                    <div style="font-weight: 500; color: var(--text-primary);">${escapeHTML(user.name)}</div>
                </td>
                <td>
                    <span style="font-family: monospace; font-size: 0.9rem; background-color: var(--bg); padding: 0.2rem 0.5rem; border-radius: 6px; border: 1px solid var(--border); color: var(--text-primary);">${escapeHTML(user.email)}</span>
                </td>
                <td>
                    <div class="table-project-cell" style="display: flex; align-items: center; gap: 0.4rem;">
                        <span class="project-badge" style="font-family: monospace; font-size: 0.9rem; background-color: var(--primary-alpha); color: var(--primary); padding: 0.2rem 0.5rem; border-radius: 6px; border: 1px solid hsla(var(--primary-hsl), 0.2); font-weight: 500;">${escapeHTML(projectToDisplay)}</span>
                        <button class="btn-copy-tiny" data-text="${escapeHTML(projectToDisplay)}" title="Copy Project ID" aria-label="Copy Project ID">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                </td>
                <td style="color: var(--text-secondary); font-size: 0.9rem;">
                    ${dateStr}
                </td>
                <td style="text-align: center;">
                    <button class="btn-delete-row" title="Delete User Account" aria-label="Delete User ${escapeHTML(user.username)}">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </td>
            `;

            // Wire up tiny project ID copy button
            const copyProjBtn = row.querySelector('.btn-copy-tiny');
            if (copyProjBtn) {
                copyProjBtn.addEventListener('click', async () => {
                    const text = copyProjBtn.getAttribute('data-text');
                    try {
                        await navigator.clipboard.writeText(text);
                        showToastMessage('Project ID copied!');
                    } catch (err) {
                        console.error('Failed to copy project ID:', err);
                    }
                });
            }

            // Wire up delete event
            const deleteBtn = row.querySelector('.btn-delete-row');
            deleteBtn.addEventListener('click', () => handleDeleteUser(user.username, row));

            usersListBody.appendChild(row);
        });
    }

    async function handleDeleteUser(username, rowElement) {
        const confirmMsg = `Are you sure you want to permanently delete the user account '${username}'?\n\nThis will:\n1. Remove the user from Cloud Identity.\n2. Delete their administrative GCP role assignments.\n3. Clean them from the Labs list.\n\nThis action cannot be undone.`;
        
        if (!confirm(confirmMsg)) {
            return;
        }

        // Show deleting state in UI
        rowElement.classList.add('row-deleting');
        const deleteBtn = rowElement.querySelector('.btn-delete-row');
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = `<div class="delete-spinner"></div>`;

        try {
            const response = await fetch(`/api/users?username=${encodeURIComponent(username)}&clientId=${encodeURIComponent(clientId)}`, {
                method: 'DELETE'
            });

            let result;
            try {
                result = await response.json();
            } catch (e) {
                result = {};
            }

            if (!response.ok) {
                throw new Error(result.error || 'Failed to delete user');
            }

            // Show success toast
            showToastMessage(`User '${username}' deleted successfully`);

            // Update localStorage list
            const currentUsers = getStoredAccounts();
            const updatedUsers = currentUsers.filter(u => u.username !== username);
            saveStoredAccounts(updatedUsers);

            // Re-render
            fetchAndRenderAccounts();

        } catch (err) {
            console.error('Deletion error:', err);
            alert(`Failed to delete user: ${err.message}`);
            
            // Revert row state
            rowElement.classList.remove('row-deleting');
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            `;
        }
    }

    // Helper to escape HTML characters
    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }

    // Search input handler
    searchUsersInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (query === '') {
            renderAccounts(provisionedUsers);
            return;
        }

        const filtered = provisionedUsers.filter(u => 
            u.name.toLowerCase().includes(query) || 
            u.username.toLowerCase().includes(query) || 
            u.email.toLowerCase().includes(query)
        );
        renderAccounts(filtered);
    });

    // Initial Startup Invocation
    fetchConfig();
    fetchAndRenderAccounts();
});
