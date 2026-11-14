'use strict';
/* One race meeting only. Four hours after its final scheduled start is a
 * generous boundary, not a claim that the session is actually live. */
function managerWeekend(schedule, now = Date.now()) {
  const events = (Array.isArray(schedule) ? schedule : []).map(event => {
    const sessions = (Array.isArray(event.sessions) ? event.sessions : [])
      .filter(session => Number.isFinite(session.ts))
      .map(session => ({ name: String(session.name || 'Session'), start: session.ts }))
      .sort((a,b) => a.start - b.start);
    return { name: String(event.name || 'Grand Prix'), round: event.round, sessions };
  }).filter(event => event.sessions.length).sort((a,b) => a.sessions[0].start - b.sessions[0].start);
  return events.find(event => now < event.sessions[event.sessions.length - 1].start + 4 * 3600_000) || null;
}
module.exports = { managerWeekend };
