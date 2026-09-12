import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPortfolioEmbed } from '../src/utils/embedFormatter';
import {
    buildPortfolioModal,
    parsePortfolioEditId,
    portfolioAuthorId,
    readPortfolioEmbed,
    PORTFOLIO_EDIT_PREFIX
} from '../src/systems/portfolio/portfolio-post-editor';

// Lý do có test này: bài portfolio KHÔNG có row DB — nội dung cũ chỉ tồn tại trong embed của
// chính tin nhắn. Nếu đọc ngược sai, modal sửa mở ra với ô trống và người dùng tưởng mất bài,
// gõ lại từ đầu. Vòng embed -> đọc lại -> embed phải khép kín, và nó phụ thuộc vào nhãn field
// nên phải có test khoá lại chứ không dựa vào việc nhớ đừng đổi nhãn.

const user = { tag: 'saly#0001', displayAvatarURL: () => 'https://cdn.example/a.png' } as any;

const SAMPLE = {
    name: 'Saly, 20',
    experience: '3 năm',
    service: 'Build map, setup server Paper',
    link: 'https://example.com/portfolio',
    contact: 'Discord: saly'
};

test('vong khep kin: dung embed roi doc nguoc ra dung nhung gi da go', () => {
    // toJSON() cho ra dung hinh dang `Embed` ma runtime doc duoc (interaction.message.embeds[0]),
    // khac voi EmbedBuilder — builder giau fields trong `.data`.
    const embed = buildPortfolioEmbed(user, SAMPLE.name, SAMPLE.experience, SAMPLE.service, SAMPLE.link, SAMPLE.contact).toJSON();
    const read = readPortfolioEmbed(embed as any);
    assert.equal(read.name, SAMPLE.name, 'ten bi boc trong ** nen phai go lai');
    assert.equal(read.experience, SAMPLE.experience);
    assert.equal(read.service, SAMPLE.service, 'dich vu nam trong code block nen phai go ```');
    assert.equal(read.portfolioLink, SAMPLE.link);
    assert.equal(read.contact, SAMPLE.contact);
});

test('embed thieu field / khong phai portfolio thi tra chuoi rong, khong nem', () => {
    assert.deepEqual(readPortfolioEmbed(null), {
        name: '', experience: '', service: '', portfolioLink: '', contact: ''
    });
    assert.deepEqual(readPortfolioEmbed({ fields: [] } as any), {
        name: '', experience: '', service: '', portfolioLink: '', contact: ''
    });
    // Bai cu thieu mot so field van doc duoc phan con lai.
    const partial = readPortfolioEmbed({ fields: [{ name: '⏱️ Kinh nghiệm', value: '**5 năm**' }] } as any);
    assert.equal(partial.experience, '5 năm');
    assert.equal(partial.name, '');
});

test('khop nhan theo tu khoa nen emoji dung truoc khong lam hong viec doc', () => {
    const read = readPortfolioEmbed({
        fields: [
            { name: '<:customer:123> Tên / Tuổi', value: '**A**' },
            { name: '<:service:456> Dịch vụ cung cấp', value: '```\nB\n```' },
            { name: '<:portfolio:789> Portfolio', value: 'C' },
            { name: '<:contact:321> Liên hệ', value: 'D' }
        ]
    } as any);
    assert.deepEqual(
        [read.name, read.service, read.portfolioLink, read.contact],
        ['A', 'B', 'C', 'D']
    );
});

test('modal sua duoc dien san noi dung cu; modal dang moi thi de trong', () => {
    const edit = buildPortfolioModal('pfedit_123456789012', {
        name: 'Saly', experience: '3 năm', service: 'Build', portfolioLink: 'https://x.test', contact: 'dm'
    }).toJSON() as any;
    const values = edit.components.map((row: any) => row.components[0].value);
    assert.deepEqual(values, ['Saly', '3 năm', 'Build', 'https://x.test', 'dm']);
    assert.equal(edit.title, 'Sửa bài quảng bá');

    const fresh = buildPortfolioModal('portfolio_modal').toJSON() as any;
    // setValue('') bi Discord tu choi, nen o trong phai la undefined chu khong phai ''.
    for (const row of fresh.components) assert.equal(row.components[0].value, undefined);
    assert.equal(fresh.title, 'Quảng Bá Bản Thân');
});

test('gia tri qua dai bi cat theo maxLength, khong thi modal khong mo duoc', () => {
    const modal = buildPortfolioModal('pfedit_123456789012', { name: 'x'.repeat(500) }).toJSON() as any;
    assert.equal(modal.components[0].components[0].value.length, 100);
});

test('parse id nut sua: chi nhan id dang so, tu choi thu khac', () => {
    assert.equal(parsePortfolioEditId(`${PORTFOLIO_EDIT_PREFIX}123456789012345`), '123456789012345');
    assert.equal(parsePortfolioEditId('bump_123456789012345'), null);
    assert.equal(parsePortfolioEditId(`${PORTFOLIO_EDIT_PREFIX}abc`), null);
    assert.equal(parsePortfolioEditId(PORTFOLIO_EDIT_PREFIX), null);
    assert.equal(parsePortfolioEditId(''), null);
});

test('tac gia portfolio khong bao gio fallback sang nguoi dang bam', () => {
    assert.equal(portfolioAuthorId('123456789012345', ''), '123456789012345');
    assert.equal(portfolioAuthorId(null, '<@!987654321098765> noi dung'), '987654321098765');
    assert.equal(portfolioAuthorId(null, 'khong co mention'), null);
    assert.equal(portfolioAuthorId('fake', '<@123456789012345>'), '123456789012345');
});
