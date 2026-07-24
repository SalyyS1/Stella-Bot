export type Locale = 'vi' | 'en';

export const translations = {
    vi: {
        'language.name': 'Tiếng Việt',
        'language.updated': 'Đã đổi ngôn ngữ server sang **{localeName}**.',
        'language.current': 'Ngôn ngữ hiện tại của server là **{localeName}**.',
        'error.adminOnly': 'Bạn cần quyền Administrator để dùng lệnh này.',
        'request.claimed': 'Bạn đã nhận request #{id}.',
        'request.alreadyClaimed': 'Request này đã có người nhận.',
        'request.ownClaim': 'Bạn không thể nhận request của chính mình.',
        'request.closed': 'Request #{id} đã được đóng.',
        'request.completed': 'Request #{id} đã hoàn thành. Stella đã gửi bảng rate.',
        'request.rateThanks': 'Đã gửi đánh giá {rating}/5 cho <@{targetId}>. Cảm ơn bạn.',
        'request.rateNotAllowed': 'Chỉ chủ request mới được rate request này.',
        'request.rateNoTarget': 'Request này chưa có người nhận để rate.',
        'request.alreadyRated': 'Request này đã được đánh giá rồi.',
        'showcase.reconcileDone': 'Reconcile showcase xong: quét {scanned}, tạo DB {created}, thêm reaction {reacted}, sync vote {votes}, publish {published}.'
    },
    en: {
        'language.name': 'English',
        'language.updated': 'Server language changed to **{localeName}**.',
        'language.current': 'Current server language is **{localeName}**.',
        'error.adminOnly': 'You need Administrator permission to use this command.',
        'request.claimed': 'You claimed request #{id}.',
        'request.alreadyClaimed': 'This request is already claimed.',
        'request.ownClaim': 'You cannot claim your own request.',
        'request.closed': 'Request #{id} has been closed.',
        'request.completed': 'Request #{id} is completed. Stella sent the rating panel.',
        'request.rateThanks': 'Submitted {rating}/5 rating for <@{targetId}>. Thank you.',
        'request.rateNotAllowed': 'Only the request owner can rate this request.',
        'request.rateNoTarget': 'This request has no claimed worker to rate.',
        'request.alreadyRated': 'This request has already been rated.',
        'showcase.reconcileDone': 'Showcase reconcile done: scanned {scanned}, DB created {created}, reacted {reacted}, votes synced {votes}, published {published}.'
    }
} as const;

export type TranslationKey = keyof typeof translations.vi;
