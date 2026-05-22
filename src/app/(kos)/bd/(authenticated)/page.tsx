/**
 * /bd — BD console home placeholder.
 *
 * The real inbox ships in Week 5 (conversations from WhatsApp + web
 * land here for triage / reply). Week 2 only proves that the
 * (authenticated) layout works end-to-end.
 */

export const metadata = {
  title: "BD Inbox · KOS",
};

export default function BdHomePage() {
  return (
    <div>
      <h1
        style={{
          fontSize: 24,
          fontWeight: 800,
          marginBottom: 10,
          letterSpacing: "-0.02em",
        }}
      >
        BD Inbox
      </h1>
      <p style={{ fontSize: 14, opacity: 0.7, lineHeight: 1.6, maxWidth: 600 }}>
        Coming in Week 5 — conversations escalated from the bot, BD-assigned
        leads, and reply composer all land here. For now, use the{" "}
        <strong>Documents</strong> link in the sidebar to upload the source PDFs
        that power the retrieval bot.
      </p>
    </div>
  );
}
