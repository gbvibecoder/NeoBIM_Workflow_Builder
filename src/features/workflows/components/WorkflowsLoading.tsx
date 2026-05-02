import s from "./page.module.css";

export function WorkflowsLoading() {
  return (
    <div className={s.loadingWrap}>
      <div className={s.loadingSpinner} />
      <span className={s.loadingLabel}>Loading workflows...</span>
    </div>
  );
}
