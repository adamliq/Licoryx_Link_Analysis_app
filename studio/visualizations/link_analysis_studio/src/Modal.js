/*
 * Minimal, dependency-free replacement for the Bootstrap-based Modal used by the
 * classic visualization. Dashboard Studio renders custom visualizations in a
 * sandboxed iframe without Splunk's Bootstrap, so this implements the subset of
 * the API the visualization uses: title/body/footer (jQuery objects), show(),
 * hide(), [data-dismiss="modal"] buttons, and "hide"/"hidden.bs.modal" events.
 */
import $ from 'jquery';

export default class Modal {
    constructor(id, options = {}) {
        this.options = Object.assign({ backdrop: true, keyboard: true, destroyOnHide: true }, options);
        this.title = $('<h3>').addClass('lla-modal-title');
        this.body = $('<div>').addClass('lla-modal-body');
        this.footer = $('<div>').addClass('lla-modal-footer');

        const close = $('<button>')
            .attr({ type: 'button', 'aria-label': 'Close', 'data-dismiss': 'modal' })
            .addClass('lla-modal-close')
            .html('&times;');
        const header = $('<div>').addClass('lla-modal-header').append(this.title, close);
        this.dialog = $('<div>')
            .addClass('lla-modal-dialog')
            .attr({ role: 'dialog', 'aria-modal': 'true' })
            .append(header, this.body, this.footer);
        this.$el = $('<div>').addClass('lla-modal-backdrop').attr('id', id).append(this.dialog);

        if (this.options.title != null) this.setTitle(this.options.title);

        // Any element marked data-dismiss="modal" closes the dialog (after its own click handlers).
        this.$el.on('click', '[data-dismiss="modal"]', () => setTimeout(() => this.hide(), 0));
        if (this.options.backdrop === true) {
            this.$el.on('click', (e) => {
                if (e.target === this.$el[0]) this.hide();
            });
        }
        this._onKey = (e) => {
            if (e.key === 'Escape' && this.options.keyboard !== false) this.hide();
        };
    }

    setTitle(text) {
        this.title.text(text);
    }

    setAlert() {}

    removeAlert() {}

    show() {
        // Only one dialog at a time (the classic viz reuses the id "modal1").
        $('.lla-modal-backdrop').not(this.$el).remove();
        $(document.body).append(this.$el);
        $(document).on('keydown', this._onKey);
        this.$el.trigger('show').trigger('show.bs.modal');
        const first = this.body.find('input, select, textarea').first();
        if (first.length) first.trigger('focus');
    }

    hide() {
        if (!this.$el.parent().length) return;
        this.$el.trigger('hide').trigger('hide.bs.modal');
        $(document).off('keydown', this._onKey);
        if (this.options.destroyOnHide !== false) this.$el.remove();
        else this.$el.detach();
        this.$el.trigger('hidden.bs.modal');
    }
}
