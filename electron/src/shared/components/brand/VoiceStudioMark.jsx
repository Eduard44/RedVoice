import React from 'react';

/**
 * RedVoice's compact mark: the letters R and V set in Roboto. The desktop icon
 * shows the same letters on a dark tile; app chrome keeps them transparent so
 * the mark stays crisp at titlebar sizes and in every theme. The component keeps
 * its upstream name so shared imports do not change.
 */
export default function VoiceStudioMark({ className = '', title, ...props }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        transform="translate(4 49) scale(1.25)"
        d="M1.84 -24.17H11.36Q14.14 -24.17 16.2 -23.34Q18.26 -22.51 19.38 -20.88Q20.5 -19.26 20.5 -16.87Q20.5 -14.79 19.86 -13.4Q19.21 -12 18.05 -11.1Q16.9 -10.19 15.37 -9.61L13.46 -8.53H5.48L5.45 -13.03H11.36Q12.47 -13.03 13.2 -13.43Q13.93 -13.83 14.3 -14.57Q14.68 -15.31 14.68 -16.34Q14.68 -17.38 14.29 -18.13Q13.91 -18.88 13.17 -19.27Q12.43 -19.67 11.36 -19.67H7.67V0H1.84ZM15.07 0 9.73 -10.69 15.9 -10.72 21.32 -0.25V0Z"
        fill="currentColor"
      />
      <path
        transform="translate(30.5 49) scale(1.25)"
        d="M10.99 -5.69 16.02 -24.17H22.54L14.39 0H10.18ZM6.42 -24.17 11.46 -5.69 12.3 0H8.04L-0.07 -24.17Z"
        fill="currentColor"
        opacity="0.72"
      />
    </svg>
  );
}
