import { Footer, Header } from '@/components/site-chrome';

/**
 * While /account asks the server who is signed in: the page's own frame
 * with a quiet placeholder card, so a tap on the header chip or on
 * Settings' "Manage" answers at once. The pulse stops under reduced motion
 * (app/styles/motion.css).
 */
export default function AccountLoading() {
  return (
    <>
      <Header />
      <main id="main-content" className="account-main">
        <div className="account-page section-wrap" aria-busy="true">
          <p className="eyebrow purple">YOUR ACCOUNT</p>
          <section className="account-card account-loading">
            <output className="account-loading-text">
              Opening your account…
            </output>
            <span className="account-loading-bar" aria-hidden="true" />
            <span
              className="account-loading-bar account-loading-bar-short"
              aria-hidden="true"
            />
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
