/**
 * leads.js — Lead management page logic.
 * Handles: listing, adding, editing, deleting leads, Excel upload.
 */

let allLeads = [];
let allWhatsAppTemplates = [];
let allEmailTemplates = [];

document.addEventListener('DOMContentLoaded', async () => {
    await loadLeads();
    await loadWhatsAppTemplates();
    await loadEmailTemplates();
    setupLeadActions();
});

async function loadEmailTemplates() {
    try {
        const res = await apiGet('/api/campaigns/settings/email-templates');
        if (res.ok) {
            allEmailTemplates = await res.json();
        }
    } catch (err) {
        console.error('Failed to load email templates:', err);
    }
}

async function loadWhatsAppTemplates() {
    try {
        const res = await apiGet('/api/campaigns/settings/whatsapp-templates');
        if (res.ok) {
            allWhatsAppTemplates = await res.json();
        }
    } catch (err) {
        console.error('Failed to load templates:', err);
    }
}

// ──────────────────────────────────────────────
//  Load Leads
// ──────────────────────────────────────────────
async function loadLeads() {
    try {
        const statusFilter = document.getElementById('statusFilter').value;
        const sourceFilter = document.getElementById('sourceFilter').value;
        const search = document.getElementById('searchInput').value;

        let url = '/api/leads?';
        if (statusFilter) url += `status=${statusFilter}&`;
        if (sourceFilter) url += `source=${sourceFilter}&`;
        if (search) url += `search=${encodeURIComponent(search)}&`;

        const res = await apiGet(url);
        if (!res || !res.ok) return;

        allLeads = await res.json();
        renderLeadsTable(allLeads);

        // Update badge
        const badge = document.getElementById('leadCount');
        if (badge) badge.textContent = allLeads.length;
    } catch (err) {
        console.error('Failed to load leads:', err);
    }
}

function renderLeadsTable(leads) {
    const tbody = document.getElementById('leadsTableBody');

    if (leads.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="9" style="padding:60px;text-align:center;color:#9CA3AF;">
                <div style="font-size:2rem;margin-bottom:12px;">👥</div>
                <strong style="color:#4B5563;">No leads found</strong><br>
                <span style="font-size:0.8125rem;">Add your first lead or upload an Excel file</span>
            </td></tr>
        `;
        return;
    }

    tbody.innerHTML = leads.map(lead => `
        <tr>
            <td><input type="checkbox" class="lead-checkbox" data-id="${lead.id}"></td>
            <td><strong>${lead.company_name || '—'}</strong></td>
            <td>${lead.contact_name || '—'}</td>
            <td>${lead.email ? `<a href="mailto:${lead.email}" style="color:#2563EB;">${lead.email}</a>` : '—'}</td>
            <td>${lead.phone || '—'}</td>
            <td>${statusBadge(lead.source)}</td>
            <td>${statusBadge(lead.status)}</td>
            <td>${formatDate(lead.created_at)}</td>
            <td>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button class="btn btn-sm btn-secondary" style="padding: 6px 10px;" onclick="editLead(${lead.id})" title="Edit">✏️</button>
                    <button class="btn btn-sm btn-secondary" style="padding: 6px 10px; ${!lead.email ? 'opacity:0.3; cursor:not-allowed;' : ''}" ${!lead.email ? 'disabled' : `onclick="sendCampaign(${lead.id},'email')"`} title="Email">📧</button>
                    <button class="btn btn-sm btn-secondary" style="padding: 6px 10px; ${!lead.phone ? 'opacity:0.3; cursor:not-allowed;' : ''}" ${!lead.phone ? 'disabled' : `onclick="sendCampaign(${lead.id},'whatsapp')"`} title="WhatsApp">💬</button>
                    <button class="btn btn-sm btn-danger" style="padding: 6px 10px;" onclick="deleteLead(${lead.id}, this)" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// ──────────────────────────────────────────────
//  Setup Actions
// ──────────────────────────────────────────────
function setupLeadActions() {
    // Search
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(loadLeads, 400);
    });

    // Status filter
    document.getElementById('statusFilter').addEventListener('change', loadLeads);

    // Source filter
    const sourceFilterEl = document.getElementById('sourceFilter');
    if (sourceFilterEl) sourceFilterEl.addEventListener('change', loadLeads);

    // Add lead
    document.getElementById('btnAddLead').addEventListener('click', showAddLeadModal);

    // Upload Excel
    document.getElementById('btnUploadExcel').addEventListener('click', () => {
        document.getElementById('excelFileInput').click();
    });

    document.getElementById('excelFileInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        const uploadBtn = document.getElementById('btnUploadExcel');
        withLoadingState(uploadBtn, 'Uploading...', async () => {
            showToast('Uploading Excel file...', 'info');
            try {
                const res = await apiUpload('/api/leads/upload/excel', formData);
                const data = await res.json();

                if (res.ok) {
                    showToast(`${data.imported} leads imported successfully!`, 'success');
                    await loadLeads();
                } else {
                    showToast(data.detail || 'Upload failed', 'error');
                }
            } catch (err) {
                showToast('Upload failed: ' + err.message, 'error');
            }
        });

        e.target.value = ''; // Reset file input
    });

    // Delete All Leads
    const btnDeleteAllLeads = document.getElementById('btnDeleteAllLeads');
    if (btnDeleteAllLeads) {
        btnDeleteAllLeads.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to delete ALL leads? This action cannot be undone.')) return;
            withLoadingState(btnDeleteAllLeads, 'Deleting...', async () => {
                try {
                    const res = await apiDelete('/api/leads/all');
                    if (res.ok) {
                        showToast('All leads deleted successfully', 'success');
                        await loadLeads();
                    } else {
                        const err = await res.json();
                        showToast(err.detail || 'Failed to delete leads', 'error');
                    }
                } catch (err) {
                    showToast('Error: ' + err.message, 'error');
                }
            });
        });
    }

    // OCR Scan Card
    const btnScanCard = document.getElementById('btnScanCard');
    const cardFileInput = document.getElementById('cardFileInput');
    
    if (btnScanCard && cardFileInput) {
        btnScanCard.addEventListener('click', () => {
            cardFileInput.click();
        });

        cardFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            showToast('Scanning image, please wait...', 'info');
            btnScanCard.disabled = true;

            const formData = new FormData();
            formData.append('file', file);

            try {
                const res = await apiUpload('/api/leads/upload/ocr', formData);
                const data = await res.json();

                if (res.ok) {
                    showOCRLeadModal(data.extracted);
                } else {
                    showToast(data.detail || 'Scan failed', 'error');
                }
            } catch (err) {
                showToast('Scan failed: ' + err.message, 'error');
            }

            btnScanCard.disabled = false;
            e.target.value = ''; // Reset file input
        });
    }

    // Bulk Campaign setup
    const selectAll = document.getElementById('selectAllLeads');
    if (selectAll) {
        selectAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.lead-checkbox').forEach(cb => cb.checked = isChecked);
            updateBulkCampaignBtn();
        });
    }

    document.getElementById('leadsTableBody').addEventListener('change', (e) => {
        if (e.target.classList.contains('lead-checkbox')) {
            updateBulkCampaignBtn();
            const allChecked = Array.from(document.querySelectorAll('.lead-checkbox')).every(cb => cb.checked);
            const noneChecked = Array.from(document.querySelectorAll('.lead-checkbox')).every(cb => !cb.checked);
            if (selectAll) {
                selectAll.checked = allChecked;
                if (noneChecked) selectAll.checked = false;
            }
        }
    });

    const btnBulk = document.getElementById('btnBulkCampaign');
    if (btnBulk) {
        btnBulk.addEventListener('click', () => {
            const selectedIds = Array.from(document.querySelectorAll('.lead-checkbox:checked')).map(cb => parseInt(cb.dataset.id));
            if (selectedIds.length === 0) return;
            showBulkCampaignModal(selectedIds);
        });
    }
}

function updateBulkCampaignBtn() {
    const anyChecked = document.querySelectorAll('.lead-checkbox:checked').length > 0;
    const btn = document.getElementById('btnBulkCampaign');
    if (btn) {
        if (anyChecked) btn.classList.remove('hidden');
        else btn.classList.add('hidden');
    }
}

// ──────────────────────────────────────────────
//  Add Lead Modal
// ──────────────────────────────────────────────
function showAddLeadModal() {
    const html = `
        <div class="form-group">
            <label for="addCompany">Company Name</label>
            <input type="text" id="addCompany" class="form-input" style="padding-left:14px;" placeholder="e.g., Acme Corp">
        </div>
        <div class="form-group">
            <label for="addContact">Contact Name</label>
            <input type="text" id="addContact" class="form-input" style="padding-left:14px;" placeholder="e.g., John Doe">
        </div>
        <div class="form-group">
            <label for="addEmail">Email</label>
            <input type="email" id="addEmail" class="form-input" style="padding-left:14px;" placeholder="e.g., john@acme.com">
        </div>
        <div class="form-group">
            <label for="addPhone">Phone</label>
            <input type="text" id="addPhone" class="form-input" style="padding-left:14px;" placeholder="e.g., +91 98765 43210">
        </div>
        <div class="form-group">
            <label for="addNotes">Notes</label>
            <textarea id="addNotes" class="form-input" style="padding-left:14px;min-height:80px;resize:vertical;" placeholder="Any additional notes..."></textarea>
        </div>
    `;

    showModal('Add New Lead', html, async (close) => {
        const body = {
            company_name: document.getElementById('addCompany').value || null,
            contact_name: document.getElementById('addContact').value || null,
            email: document.getElementById('addEmail').value || null,
            phone: document.getElementById('addPhone').value || null,
            notes: document.getElementById('addNotes').value || null,
            source: 'manual',
        };

        if (!body.company_name && !body.contact_name && !body.email && !body.phone) {
            showToast('Please fill in at least one field', 'error');
            return;
        }

        try {
            const res = await apiPost('/api/leads', body);
            if (res.ok) {
                showToast('Lead created successfully!', 'success');
                close();
                await loadLeads();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to create lead', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

// ──────────────────────────────────────────────
//  Edit Lead Modal
// ──────────────────────────────────────────────
async function editLead(leadId) {
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    const html = `
        <div class="form-group">
            <label for="editCompany">Company Name</label>
            <input type="text" id="editCompany" class="form-input" style="padding-left:14px;" value="${lead.company_name || ''}">
        </div>
        <div class="form-group">
            <label for="editContact">Contact Name</label>
            <input type="text" id="editContact" class="form-input" style="padding-left:14px;" value="${lead.contact_name || ''}">
        </div>
        <div class="form-group">
            <label for="editEmail">Email</label>
            <input type="email" id="editEmail" class="form-input" style="padding-left:14px;" value="${lead.email || ''}">
        </div>
        <div class="form-group">
            <label for="editPhone">Phone</label>
            <input type="text" id="editPhone" class="form-input" style="padding-left:14px;" value="${lead.phone || ''}">
        </div>
        <div class="form-group">
            <label for="editStatus">Status</label>
            <select id="editStatus" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="new" ${lead.status === 'new' ? 'selected' : ''}>New</option>
                <option value="contacted" ${lead.status === 'contacted' ? 'selected' : ''}>Contacted</option>
                <option value="won" ${lead.status === 'won' ? 'selected' : ''}>Approved</option>
                <option value="lost" ${lead.status === 'lost' ? 'selected' : ''}>Lost</option>
            </select>
        </div>
        <div class="form-group">
            <label for="editNotes">Notes</label>
            <textarea id="editNotes" class="form-input" style="padding-left:14px;min-height:80px;resize:vertical;">${lead.notes || ''}</textarea>
        </div>
    `;

    showModal('Edit Lead', html, async (close) => {
        const body = {
            company_name: document.getElementById('editCompany').value || null,
            contact_name: document.getElementById('editContact').value || null,
            email: document.getElementById('editEmail').value || null,
            phone: document.getElementById('editPhone').value || null,
            status: document.getElementById('editStatus').value,
            notes: document.getElementById('editNotes').value || null,
        };

        try {
            const res = await apiPut(`/api/leads/${leadId}`, body);
            if (res.ok) {
                showToast('Lead updated successfully!', 'success');
                close();
                await loadLeads();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to update lead', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

// ──────────────────────────────────────────────
//  Delete Lead
// ──────────────────────────────────────────────
async function deleteLead(leadId, btn) {
    if (!confirm('Are you sure you want to delete this lead and all its campaigns?')) return;

    withLoadingState(btn, '🗑️...', async () => {
        try {
            const res = await apiDelete(`/api/leads/${leadId}`);
            if (res.ok) {
                showToast('Lead deleted successfully', 'success');
                await loadLeads();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to delete lead', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}

// ──────────────────────────────────────────────
//  Send Campaign (quick action from leads table)
// ──────────────────────────────────────────────
function sendCampaign(leadId, type) {
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    const isEmail = type === 'email';
    const recipient = isEmail ? lead.email : lead.phone;

    const html = `
        <p style="margin-bottom:16px;color:#6B7280;">
            Sending ${isEmail ? 'email' : 'WhatsApp'} to: <strong>${recipient}</strong>
        </p>
        ${isEmail ? `
        <div class="form-group">
            <label for="campSubject">Subject</label>
            <input type="text" id="campSubject" class="form-input" style="padding-left:14px;" placeholder="Email subject">
        </div>
        <div class="form-group">
            <label for="campMessage">Email Template</label>
            <select id="campMessage" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="">-- Select Template --</option>
                ${allEmailTemplates.length > 0 ? allEmailTemplates.map(t => `<option value="${t.id}">${t.name}</option>`).join('') : '<option value="" disabled>No email templates found (ask admin to add)</option>'}
            </select>
        </div>` : `
        <div class="form-group">
            <label for="campMessage">WhatsApp Template</label>
            <select id="campMessage" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="">-- Select Template --</option>
                ${allWhatsAppTemplates.map(t => `<option value="${t.code_name}">${t.name} (${t.code_name})</option>`).join('')}
            </select>
        </div>
        `}
    `;


    showModal(`Send ${isEmail ? 'Email' : 'WhatsApp'} Campaign`, html, async (close) => {
        const messageVal = document.getElementById('campMessage').value;
        if (!messageVal.trim()) {
            showToast('Please select a template', 'error');
            return;
        }

        let finalMessage = messageVal;
        let isHtml = false;

        if (isEmail) {
            const template = allEmailTemplates.find(t => t.id == messageVal);
            if (!template) {
                showToast('Invalid template selected', 'error');
                return;
            }
            finalMessage = template.html_body;
            isHtml = true;
        }

        const body = {
            lead_id: leadId,
            campaign_type: type,
            subject: isEmail ? (document.getElementById('campSubject')?.value || 'Message from Lead Manager') : null,
            message: finalMessage,
            is_html: isHtml,
        };

        try {
            const endpoint = isEmail ? '/api/campaigns/email' : '/api/campaigns/whatsapp';
            const res = await apiPost(endpoint, body);
            const data = await res.json();

            if (res.ok && data.send_result.success) {
                showToast(`${isEmail ? 'Email' : 'WhatsApp'} sent successfully!`, 'success');
                close();
                await loadLeads();
            } else {
                showToast(data.send_result?.message || data.detail || 'Campaign failed', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}


// ──────────────────────────────────────────────
//  Bulk Campaign 
// ──────────────────────────────────────────────
function showBulkCampaignModal(selectedIds) {
    const html = `
        <p style="margin-bottom:16px;color:#6B7280;">
            Sending campaign to: <strong>${selectedIds.length}</strong> selected leads.
        </p>
        <div class="form-group">
            <label for="bulkCampType">Campaign Type</label>
            <select id="bulkCampType" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="email">Email</option>
                <option value="whatsapp">WhatsApp</option>
            </select>
        </div>
        <div class="form-group" id="bulkSubjectGroup">
            <label for="bulkCampSubject">Subject</label>
            <input type="text" id="bulkCampSubject" class="form-input" style="padding-left:14px;" placeholder="Email subject">
        </div>
        <div id="bulkEmailTemplateContainer" class="form-group">
            <label for="bulkCampEmailTemplate">Email Template</label>
            <select id="bulkCampEmailTemplate" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="">-- Select Email Template --</option>
                ${allEmailTemplates.length > 0 ? allEmailTemplates.map(t => `<option value="${t.id}">${t.name}</option>`).join('') : '<option value="" disabled>No email templates found (ask admin to add)</option>'}
            </select>
        </div>
        <div id="bulkTemplateContainer" class="form-group hidden">
            <label for="bulkCampTemplate">WhatsApp Template</label>
            <select id="bulkCampTemplate" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="">-- Select Template --</option>
                ${allWhatsAppTemplates.map(t => `<option value="${t.code_name}">${t.name} (${t.code_name})</option>`).join('')}
            </select>
        </div>
    `;

    showModal('Run Bulk Campaign', html, async (close) => {
        const type    = document.getElementById('bulkCampType').value;
        const isWA    = type === 'whatsapp';
        const templateId = isWA ? document.getElementById('bulkCampTemplate').value : document.getElementById('bulkCampEmailTemplate').value;
        const subject = document.getElementById('bulkCampSubject').value;

        if (!templateId.trim()) {
            showToast('Please select a template', 'error');
            return;
        }

        let finalMessage = templateId;
        let isHtml = false;

        if (!isWA) {
            const template = allEmailTemplates.find(t => t.id == templateId);
            if (!template) {
                showToast('Invalid template selected', 'error');
                return;
            }
            finalMessage = template.html_body;
            isHtml = true;
        }

        let successCount = 0;
        let failCount = 0;

        showToast(`Sending to ${selectedIds.length} leads in background...`, 'info');
        close();

        for (const leadId of selectedIds) {
            const body = {
                lead_id: leadId,
                campaign_type: type,
                subject: type === 'email' ? (subject || 'Message from Lead Manager') : null,
                message: finalMessage,
                is_html: isHtml,
            };

            try {
                const endpoint = type === 'email' ? '/api/campaigns/email' : '/api/campaigns/whatsapp';
                const res = await apiPost(endpoint, body);
                if (res.ok) {
                    const data = await res.json();
                    if (data.send_result && data.send_result.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } else {
                    failCount++;
                }
            } catch (err) {
                failCount++;
            }
        }

        showToast(`Bulk Run Complete: ${successCount} Sent, ${failCount} Failed`, 'success');

        document.querySelectorAll('.lead-checkbox').forEach(cb => cb.checked = false);
        const selAll = document.getElementById('selectAllLeads');
        if (selAll) selAll.checked = false;
        updateBulkCampaignBtn();
    });
    
    setTimeout(() => {
        const typeSelect = document.getElementById('bulkCampType');
        if (typeSelect) {
            const subjectGroup  = document.getElementById('bulkSubjectGroup');
            const emailTmplContainer = document.getElementById('bulkEmailTemplateContainer');
            const waTmplContainer = document.getElementById('bulkTemplateContainer');
            
            typeSelect.addEventListener('change', () => {
                const isWA = typeSelect.value === 'whatsapp';
                if (subjectGroup)  subjectGroup.classList.toggle('hidden', isWA);
                if (emailTmplContainer) emailTmplContainer.classList.toggle('hidden', isWA);
                if (waTmplContainer) waTmplContainer.classList.toggle('hidden', !isWA);
            });
        }
    }, 100);
}


// ──────────────────────────────────────────────
//  OCR Lead Modal
// ──────────────────────────────────────────────
function showOCRLeadModal(extracted) {
    const html = `
        <div class="form-group" style="margin-bottom: 20px;">
            <div class="badge badge-info" style="display:inline-block; margin-bottom:8px;">Extracted via OCR</div>
        </div>
        <div class="form-group">
            <label for="ocrCompany">Company Name</label>
            <input type="text" id="ocrCompany" class="form-input" style="padding-left:14px;" value="${extracted.company_name || ''}">
        </div>
        <div class="form-group">
            <label for="ocrContact">Contact Name</label>
            <input type="text" id="ocrContact" class="form-input" style="padding-left:14px;" value="${extracted.contact_name || ''}">
        </div>
        <div class="form-group">
            <label for="ocrEmail">Email</label>
            <input type="email" id="ocrEmail" class="form-input" style="padding-left:14px;" value="${extracted.email || ''}">
        </div>
        <div class="form-group">
            <label for="ocrPhone">Phone</label>
            <input type="text" id="ocrPhone" class="form-input" style="padding-left:14px;" value="${extracted.phone || ''}">
        </div>
    `;

    showModal('Review Scanned Lead', html, async (close) => {
        const body = {
            company_name: document.getElementById('ocrCompany').value || null,
            contact_name: document.getElementById('ocrContact').value || null,
            email: document.getElementById('ocrEmail').value || null,
            phone: document.getElementById('ocrPhone').value || null,
            notes: 'Extracted from visiting card via OCR',
            source: 'ocr',
        };

        if (!body.company_name && !body.contact_name && !body.email && !body.phone) {
            showToast('Please fill in at least one field', 'error');
            return;
        }

        try {
            const res = await apiPost('/api/leads/ocr/save', body);
            if (res.ok) {
                showToast('Lead saved successfully!', 'success');
                close();
                await loadLeads();
            } else {
                const err = await res.json();
                showToast(err.detail || 'Failed to save lead', 'error');
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
        }
    });
}
