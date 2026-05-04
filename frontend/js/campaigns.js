/**
 * campaigns.js — Campaign history page logic.
 * Includes: lead outcome update (Lost / Approved), Google Calendar meeting scheduling,
 * meeting details view (with copy link, edit, cancel), and HTML email template support.
 */

// Store current meeting data for edit re-use (avoids passing complex objects via onclick)
let _currentMeetingData = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadCampaignStats();
    await loadCampaigns();
    setupFilters();
});

async function loadCampaignStats() {
    try {
        const res = await apiGet('/api/campaigns/stats');
        if (!res || !res.ok) return;
        const stats = await res.json();

        document.getElementById('campTotal').textContent = stats.total || 0;
        document.getElementById('campSent').textContent = stats.sent || 0;
        document.getElementById('campEmail').textContent = stats.email || 0;
        document.getElementById('campWhatsApp').textContent = stats.whatsapp || 0;
    } catch (err) {
        console.error('Failed to load campaign stats:', err);
    }
}

async function loadCampaigns() {
    try {
        const typeFilter = document.getElementById('typeFilter').value;
        let url = '/api/campaigns';
        if (typeFilter) url += `?campaign_type=${typeFilter}`;

        // Fetch campaigns and meeting statuses in parallel
        const [campRes, meetRes] = await Promise.all([
            apiGet(url),
            apiGet('/api/campaigns/meeting-status'),
        ]);

        if (!campRes || !campRes.ok) return;
        const campaigns = await campRes.json();

        // Build a Set of lead_ids that have a scheduled meeting
        let meetingLeadIds = new Set();
        if (meetRes && meetRes.ok) {
            const ids = await meetRes.json();
            meetingLeadIds = new Set(ids);
        }

        const tbody = document.getElementById('campaignsTableBody');

        if (campaigns.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="8" style="padding:60px;text-align:center;color:#9CA3AF;">
                    <div style="font-size:2rem;margin-bottom:12px;">📧</div>
                    <strong style="color:#4B5563;">No campaigns yet</strong><br>
                    <span style="font-size:0.8125rem;">Go to Leads page and send your first campaign</span>
                </td></tr>
            `;
            return;
        }

        // Helper: strip HTML tags and decode entities for safe plain-text display
        const stripHtml = (html) => {
            if (!html) return '';
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
        };

        tbody.innerHTML = campaigns.map(c => {
            const leadStatus = c.lead_status || '';
            const leadId = c.lead_id;
            const leadName = (c.company_name || c.contact_name || c.lead_email || '-').replace(/'/g, "\\'");

            // Action cell logic:
            // 1. Contacted lead with sent campaign → "Update Outcome"
            // 2. Won/Approved lead with a meeting scheduled → "View Meeting"
            // 3. Everything else → dash
            let actionCell = '<span style="color:#9CA3AF;font-size:0.75rem;">—</span>';

            if (c.status === 'sent' && leadStatus === 'contacted') {
                actionCell = `
                    <button
                        class="btn btn-sm btn-primary"
                        style="padding:5px 10px;font-size:0.75rem;white-space:nowrap;"
                        onclick="showOutcomeModal(${leadId}, '${leadName}', '${c.lead_email || ''}')"
                        title="Update lead outcome: Lost or Approved"
                    >
                        📋 Update Outcome
                    </button>
                `;
            } else if (leadStatus === 'won' && meetingLeadIds.has(leadId)) {
                actionCell = `
                    <button
                        class="btn btn-sm"
                        style="padding:5px 10px;font-size:0.75rem;white-space:nowrap;background:#7C3AED;color:white;border:none;border-radius:6px;cursor:pointer;"
                        onclick="showMeetingDetailsModal(${leadId}, '${leadName}')"
                        title="View scheduled meeting details"
                    >
                        👁️ View Meeting
                    </button>
                `;
            }

            return `
                <tr>
                    <td><strong>${c.company_name || c.contact_name || c.lead_email || '-'}</strong></td>
                    <td>${c.campaign_type === 'email' ? '<span class="badge badge-info">Email</span>' : '<span class="badge badge-success">WhatsApp</span>'}</td>
                    <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${stripHtml(c.subject)}">${stripHtml(c.subject) || '-'}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${stripHtml(c.message)}">${stripHtml(c.message) || '-'}</td>
                    <td>${statusBadge(c.status)}</td>
                    <td>${leadStatus ? statusBadge(leadStatus) : '<span style="color:#9CA3AF;">—</span>'}</td>
                    <td>${c.sent_at ? formatDate(c.sent_at) : '-'}</td>
                    <td>${actionCell}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Failed to load campaigns:', err);
    }
}

function setupFilters() {
    document.getElementById('typeFilter').addEventListener('change', loadCampaigns);
}

// ──────────────────────────────────────────────
//  Outcome Modal — Lost or Approved
// ──────────────────────────────────────────────
function showOutcomeModal(leadId, leadName, leadEmail) {
    const html = `
        <p style="margin-bottom:20px;color:#6B7280;">
            Update outcome for lead: <strong>${leadName}</strong>
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:8px;">
            <button
                id="btnLost"
                class="btn"
                style="padding:18px;border:2px solid #FCA5A5;background:#FEF2F2;color:#DC2626;border-radius:12px;font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.2s;"
                onclick="confirmOutcome(${leadId}, 'lost', null, null, this)"
            >
                ❌ Lost<br>
                <span style="font-size:0.75rem;font-weight:400;opacity:0.8;">Lead did not convert</span>
            </button>
            <button
                id="btnApproved"
                class="btn"
                style="padding:18px;border:2px solid #6EE7B7;background:#ECFDF5;color:#059669;border-radius:12px;font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.2s;"
                onclick="confirmOutcome(${leadId}, 'won', '${leadName.replace(/'/g, "\\'")}', '${leadEmail || ''}', this)"
            >
                ✅ Approved<br>
                <span style="font-size:0.75rem;font-weight:400;opacity:0.8;">Schedule a meeting</span>
            </button>
        </div>
        <p style="font-size:0.75rem;color:#9CA3AF;margin-top:12px;">
            ⚠️ This action cannot be undone once saved.
        </p>
    `;

    showModal('Update Lead Outcome', html);
}

// ──────────────────────────────────────────────
//  Confirm Outcome (Lost or Won/Approved)
// ──────────────────────────────────────────────
async function confirmOutcome(leadId, outcome, leadName, leadEmail, btn) {
    const existing = document.querySelector('.modal-overlay');

    withLoadingState(btn, 'Processing...', async () => {
        if (existing) existing.remove();

        if (outcome === 'lost') {
            try {
                const res = await apiPut(`/api/campaigns/lead/${leadId}/outcome`, { outcome: 'lost' });
                if (res && res.ok) {
                    showToast('Lead marked as Lost.', 'success');
                    await loadCampaigns();
                    await loadCampaignStats();
                } else {
                    const err = await res.json();
                    showToast(err.detail || 'Failed to update outcome', 'error');
                }
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        } else if (outcome === 'won') {
            // Open scheduler directly
            showMeetingSchedulerModal(leadId, leadName, leadEmail, false);
        }
    });
}

// ──────────────────────────────────────────────
//  Meeting Scheduler Modal (create + edit)
// ──────────────────────────────────────────────
function showMeetingSchedulerModal(leadId, leadName, leadEmail, existingMeeting = null) {
    const isEdit = !!existingMeeting;

    // Prefill fields: use existing meeting data when editing
    let defaultDate, defaultTime, defaultTitle, defaultDesc, defaultDuration, defaultAttendee;

    if (isEdit) {
        const startDt = new Date(existingMeeting.start_datetime);
        defaultDate     = startDt.toISOString().slice(0, 10);
        defaultTime     = startDt.toTimeString().slice(0, 5);
        defaultTitle    = existingMeeting.title;
        defaultDesc     = existingMeeting.description || '';
        defaultDuration = existingMeeting.duration_minutes || 60;
        defaultAttendee = existingMeeting.attendee_email || leadEmail;
    } else {
        const now = new Date();
        now.setMinutes(now.getMinutes() + 60 - (now.getMinutes() % 30));
        defaultDate     = now.toISOString().slice(0, 10);
        defaultTime     = now.toTimeString().slice(0, 5);
        defaultTitle    = `Meeting with ${leadName}`;
        defaultDesc     = `Follow-up meeting with ${leadName} regarding their requirements.`;
        defaultDuration = 60;
        defaultAttendee = leadEmail;
    }

    const html = `
        <div style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4);border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #DBEAFE;">
            <div style="font-size:1.5rem;text-align:center;margin-bottom:8px;">📅</div>
            <p style="text-align:center;color:#1D4ED8;font-weight:600;margin:0;">${isEdit ? 'Edit Google Meet' : 'Schedule Google Meet'}</p>
            <p style="text-align:center;color:#6B7280;font-size:0.8125rem;margin:4px 0 0;">
                Meeting will be added to admin's Google Calendar
            </p>
        </div>

        <div class="form-group">
            <label for="meetTitle">Meeting Title</label>
            <input type="text" id="meetTitle" class="form-input" style="padding-left:14px;"
                value="${defaultTitle}" placeholder="Meeting title">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="form-group">
                <label for="meetDate">Date</label>
                <input type="date" id="meetDate" class="form-input" style="padding-left:14px;"
                    value="${defaultDate}" min="${new Date().toISOString().slice(0, 10)}">
            </div>
            <div class="form-group">
                <label for="meetTime">Time</label>
                <input type="time" id="meetTime" class="form-input" style="padding-left:14px;"
                    value="${defaultTime}">
            </div>
        </div>
        <div class="form-group">
            <label for="meetDuration">Duration (minutes)</label>
            <select id="meetDuration" class="form-input filter-select" style="padding-left:14px;width:100%;">
                <option value="30" ${defaultDuration == 30 ? 'selected' : ''}>30 minutes</option>
                <option value="60" ${defaultDuration == 60 ? 'selected' : ''}>60 minutes</option>
                <option value="90" ${defaultDuration == 90 ? 'selected' : ''}>90 minutes</option>
                <option value="120" ${defaultDuration == 120 ? 'selected' : ''}>2 hours</option>
            </select>
        </div>
        <div class="form-group">
            <label for="meetDescription">Description / Notes</label>
            <textarea id="meetDescription" class="form-input" style="padding-left:14px;min-height:70px;resize:vertical;"
                placeholder="Any notes for the meeting...">${defaultDesc}</textarea>
        </div>
        <div class="form-group">
            <label for="meetAttendee">Lead Email (Attendee)</label>
            <input type="email" id="meetAttendee" class="form-input" style="padding-left:14px;"
                value="${defaultAttendee}" placeholder="client@example.com">
        </div>

        <div id="meetResultBox" style="display:none;margin-top:16px;padding:16px;border-radius:10px;background:#ECFDF5;border:1px solid #6EE7B7;">
            <p style="color:#059669;font-weight:600;margin:0 0 8px;">✅ Meeting ${isEdit ? 'Updated' : 'Scheduled'}!</p>
            <p id="meetLinkText" style="margin:0;font-size:0.8125rem;color:#047857;word-break:break-all;"></p>
        </div>
    `;

    showModal(isEdit ? '✏️ Edit Meeting' : '📅 Schedule Meeting', html, async (close) => {
        const saveBtn     = document.getElementById('modalSave');
        const title       = document.getElementById('meetTitle').value.trim();
        const date        = document.getElementById('meetDate').value;
        const time        = document.getElementById('meetTime').value;
        const duration    = parseInt(document.getElementById('meetDuration').value);
        const description = document.getElementById('meetDescription').value.trim();
        const attendee    = document.getElementById('meetAttendee').value.trim();

        if (!title) { showToast('Please enter a meeting title', 'error'); return; }
        if (!date || !time) { showToast('Please select date and time', 'error'); return; }

        const startDatetime = `${date}T${time}:00`;
        const body = {
            lead_id: leadId,
            title,
            description,
            start_datetime: startDatetime,
            duration_minutes: duration,
            attendee_email: attendee || null,
        };

        try {
            const res = await apiPost('/api/campaigns/schedule-meeting', body);
            const data = await res.json();

            if (res.ok) {
                // On first schedule: update lead status to won
                if (!isEdit) {
                    try { await apiPut(`/api/campaigns/lead/${leadId}/outcome`, { outcome: 'won' }); } catch (_) {}
                }

                const resultBox = document.getElementById('meetResultBox');
                const linkText  = document.getElementById('meetLinkText');
                if (resultBox && linkText) {
                    linkText.innerHTML = data.meet_link
                        ? `🔗 Google Meet: <a href="${data.meet_link}" target="_blank" style="color:#059669;">${data.meet_link}</a><br>
                           📅 <a href="${data.event_link}" target="_blank" style="color:#047857;">View in Calendar</a>`
                        : `📅 <a href="${data.event_link}" target="_blank" style="color:#047857;">View event in Calendar</a>`;
                    resultBox.style.display = 'block';
                }

                showToast(isEdit ? 'Meeting updated successfully!' : 'Meeting scheduled! Lead marked as Approved.', 'success');
                await loadCampaigns();
                await loadCampaignStats();

                // Replace Save button with "👁️ View Meeting" button
                if (saveBtn) {
                    saveBtn.textContent = '👁️ View Meeting';
                    saveBtn.style.background = '#7C3AED';
                    saveBtn.disabled = false;
                    // Swap click handler: clone removes old listeners
                    const newBtn = saveBtn.cloneNode(true);
                    saveBtn.parentNode.replaceChild(newBtn, saveBtn);
                    newBtn.addEventListener('click', () => {
                        const overlay = document.querySelector('.modal-overlay');
                        if (overlay) {
                            overlay.classList.remove('show');
                            setTimeout(() => {
                                overlay.remove();
                                showMeetingDetailsModal(leadId, leadName);
                            }, 250);
                        }
                    });
                }
                // Change Cancel → Close
                const cancelBtn = document.getElementById('modalCancel');
                if (cancelBtn) cancelBtn.textContent = 'Close';

            } else {
                showToast(data.detail || 'Failed to schedule meeting', 'error');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Update Meeting' : 'Schedule Meeting'; }
            }
        } catch (err) {
            showToast('Error: ' + err.message, 'error');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Update Meeting' : 'Schedule Meeting'; }
        }
    });

    // Set initial button label after modal renders
    setTimeout(() => {
        const saveBtn = document.getElementById('modalSave');
        if (saveBtn) saveBtn.textContent = isEdit ? 'Update Meeting' : 'Schedule Meeting';
    }, 50);
}

// ──────────────────────────────────────────────
//  Meeting Details Modal
// ──────────────────────────────────────────────
async function showMeetingDetailsModal(leadId, leadName) {
    // Show loading placeholder first
    showModal('📅 Meeting Details', `
        <div style="text-align:center;padding:48px;color:#6B7280;">
            <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
            Loading meeting details...
        </div>
    `);

    try {
        const res = await apiGet(`/api/campaigns/meeting/${leadId}`);
        if (!res || !res.ok) {
            showToast('Could not load meeting details', 'error');
            const overlay = document.querySelector('.modal-overlay');
            if (overlay) overlay.remove();
            return;
        }
        const m = await res.json();
        _currentMeetingData = m; // Store for edit use

        // Format date/time for display
        const startDt  = new Date(m.start_datetime);
        const dateStr  = startDt.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        const timeStr  = startDt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const safeEmail = (m.attendee_email || '').replace(/'/g, "\\'");
        const safeTitle = (m.title || '').replace(/'/g, "\\'");

        const html = `
            <!-- Header card -->
            <div style="background:linear-gradient(135deg,#EFF6FF,#F0FDF4);border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #DBEAFE;text-align:center;">
                <div style="font-size:2rem;margin-bottom:8px;">📅</div>
                <h3 style="color:#1D4ED8;margin:0 0 6px;font-size:1.1rem;">${m.title}</h3>
                <p style="color:#6B7280;font-size:0.875rem;margin:0;">${dateStr}</p>
                <p style="color:#6B7280;font-size:0.875rem;margin:4px 0 0;">🕐 ${timeStr}</p>
            </div>

            <!-- Info rows -->
            <div style="display:grid;gap:10px;margin-bottom:20px;">
                <div style="display:flex;gap:12px;align-items:center;padding:12px 14px;background:#F9FAFB;border-radius:8px;border:1px solid #F3F4F6;">
                    <span style="font-size:1.25rem;">⏱️</span>
                    <div>
                        <div style="font-size:0.7rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;">Duration</div>
                        <div style="font-weight:600;color:#111827;">${m.duration_minutes} minutes</div>
                    </div>
                </div>
                ${m.attendee_email ? `
                <div style="display:flex;gap:12px;align-items:center;padding:12px 14px;background:#F9FAFB;border-radius:8px;border:1px solid #F3F4F6;">
                    <span style="font-size:1.25rem;">👤</span>
                    <div>
                        <div style="font-size:0.7rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;">Client Attendee</div>
                        <div style="font-weight:600;color:#111827;">${m.attendee_email}</div>
                    </div>
                </div>` : ''}
                ${m.salesperson_email ? `
                <div style="display:flex;gap:12px;align-items:center;padding:12px 14px;background:#EFF6FF;border-radius:8px;border:1px solid #DBEAFE;">
                    <span style="font-size:1.25rem;">💼</span>
                    <div>
                        <div style="font-size:0.7rem;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;">Salesperson Attendee</div>
                        <div style="font-weight:600;color:#1D4ED8;">${m.salesperson_email}</div>
                    </div>
                </div>` : ''}
                ${m.description ? `
                <div style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:#F9FAFB;border-radius:8px;border:1px solid #F3F4F6;">
                    <span style="font-size:1.25rem;">📝</span>
                    <div>
                        <div style="font-size:0.7rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;">Notes</div>
                        <div style="color:#374151;font-size:0.875rem;margin-top:2px;">${m.description}</div>
                    </div>
                </div>` : ''}
            </div>

            <!-- Google Meet link -->
            ${m.meet_link ? `
            <div style="padding:14px 16px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                    <div style="min-width:0;">
                        <div style="font-size:0.7rem;color:#065F46;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">🔗 Google Meet Link</div>
                        <div style="font-size:0.8rem;color:#047857;word-break:break-all;">${m.meet_link}</div>
                    </div>
                    <button id="copyMeetLinkBtn"
                        onclick="copyMeetLink('${m.meet_link.replace(/'/g, "\\'")}')"
                        style="flex-shrink:0;padding:8px 14px;background:#059669;color:white;border:none;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;transition:background 0.2s;"
                    >📋 Copy</button>
                </div>
            </div>` : ''}

            <!-- Calendar link -->
            ${m.event_link ? `
            <div style="margin-bottom:20px;">
                <a href="${m.event_link}" target="_blank"
                   style="display:inline-flex;align-items:center;gap:6px;color:#2563EB;font-size:0.875rem;text-decoration:none;font-weight:500;">
                    📅 View in Google Calendar →
                </a>
            </div>` : ''}

            <!-- Action buttons -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;border-top:1px solid #E5E7EB;padding-top:16px;">
                <button
                    onclick="editMeetingFromDetails(${leadId}, '${leadName.replace(/'/g, "\\'")}', '${safeEmail}')"
                    style="padding:12px;background:#EFF6FF;border:1px solid #BFDBFE;color:#1D4ED8;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.875rem;transition:background 0.2s;"
                >✏️ Edit Meeting</button>
                <button
                    onclick="cancelMeetingConfirm(${leadId}, this)"
                    style="padding:12px;background:#FEF2F2;border:1px solid #FECACA;color:#DC2626;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.875rem;transition:background 0.2s;"
                >🗑️ Cancel Meeting</button>
            </div>
        `;

        // Replace loading content with real content
        const modalBody = document.querySelector('.modal-body');
        if (modalBody) modalBody.innerHTML = html;
        const modalHeader = document.querySelector('.modal-header h3');
        if (modalHeader) modalHeader.textContent = '📅 Meeting Details';

    } catch (err) {
        showToast('Error loading meeting details: ' + err.message, 'error');
        const overlay = document.querySelector('.modal-overlay');
        if (overlay) overlay.remove();
    }
}

// ──────────────────────────────────────────────
//  Edit Meeting (from details modal)
// ──────────────────────────────────────────────
function editMeetingFromDetails(leadId, leadName, leadEmail) {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => {
            overlay.remove();
            showMeetingSchedulerModal(leadId, leadName, leadEmail, _currentMeetingData);
        }, 250);
    } else {
        showMeetingSchedulerModal(leadId, leadName, leadEmail, _currentMeetingData);
    }
}

// ──────────────────────────────────────────────
//  Copy Google Meet Link to Clipboard
// ──────────────────────────────────────────────
function copyMeetLink(link) {
    const btn = document.getElementById('copyMeetLinkBtn');

    const doFallback = () => {
        try {
            const el = document.createElement('textarea');
            el.value = link;
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            showToast('Google Meet link copied!', 'success');
            if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); }
        } catch (_) {
            showToast('Could not copy. Please copy manually.', 'error');
        }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => {
            showToast('Google Meet link copied to clipboard!', 'success');
            if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); }
        }).catch(doFallback);
    } else {
        doFallback();
    }
}

// ──────────────────────────────────────────────
//  Cancel / Delete a Scheduled Meeting
// ──────────────────────────────────────────────
async function cancelMeetingConfirm(leadId, btn) {
    if (!confirm(
        'Are you sure you want to cancel this meeting?\n\n' +
        'This will remove the meeting record from the system. ' +
        'Please also delete the event from Google Calendar manually.\n\n' +
        'This action cannot be undone.'
    )) return;

    withLoadingState(btn, '🗑️...', async () => {
        try {
        const res = await apiDelete(`/api/campaigns/meeting/${leadId}`);
        if (res && res.ok) {
            showToast('Meeting cancelled successfully.', 'success');
            const overlay = document.querySelector('.modal-overlay');
            if (overlay) overlay.remove();
            await loadCampaigns();
            await loadCampaignStats();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Failed to cancel meeting', 'error');
        }
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
    });
}
