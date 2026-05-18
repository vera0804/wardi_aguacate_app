import { PASSWORD_POLICY_SUMMARY } from '../utils/passwordPolicy.js';

export default function PasswordPolicyHint({ className = '' }) {
  return (
    <p className={`text-xs text-slate-500 ${className}`.trim()}>{PASSWORD_POLICY_SUMMARY}</p>
  );
}
