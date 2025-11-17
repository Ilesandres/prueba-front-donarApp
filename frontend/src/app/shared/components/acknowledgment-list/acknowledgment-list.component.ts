import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AcknowledgmentService, Acknowledgment, ReportAcknowledgmentDTO } from '../../../core/services/acknowledgment.service';
import { ReportService } from '../../../core/services/report.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-acknowledgment-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './acknowledgment-list.component.html',
  styleUrls: ['./acknowledgment-list.component.scss']
})
export class AcknowledgmentListComponent implements OnInit, OnDestroy {
  @Input() donationId?: number;
  @Input() postId?: number;
  @Input() donorId?: number;
  @Input() showReportButton: boolean = true;
  @Output() acknowledgmentReported = new EventEmitter<number>();

  acknowledgments: Acknowledgment[] = [];
  loading: boolean = false;
  error: string = '';
  reportingId: number | null = null;
  showReportModal: boolean = false;
  showConfirmModal: boolean = false; // Modal de confirmación antes de enviar
  showSuccessModal: boolean = false; // Modal de éxito después de enviar
  selectedAcknowledgment: Acknowledgment | null = null;
  reportReason: string = '';
  reportExtraComments: string = '';
  reportedAcknowledgmentIds: Set<number> = new Set(); // Flags locales de reportados

  private destroy$ = new Subject<void>();
  currentUserId: number | string | null = null;
  currentUserRole: string | null = null; // 'donor' | 'organization' | 'admin'

  constructor(
    private acknowledgmentService: AcknowledgmentService,
    private reportService: ReportService,
    private authService: AuthService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUserId = user?.id || null;
        this.currentUserRole = user?.role || null;
      });

    this.loadAcknowledgments();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAcknowledgments(): void {
    this.loading = true;
    this.error = '';

    let request;
    if (this.donationId) {
      request = this.acknowledgmentService.getAcknowledgmentByDonation(this.donationId);
    } else if (this.postId) {
      request = this.acknowledgmentService.getAcknowledgmentByPost(this.postId);
    } else if (this.donorId !== undefined) {
      request = this.acknowledgmentService.getAcknowledgmentByDonor(this.donorId);
    } else {
      request = this.acknowledgmentService.getAcknowledgmentByDonor();
    }

    request.pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.acknowledgments = Array.isArray(data) ? data : [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Error al cargar agradecimientos';
        this.loading = false;
        this.toastService.error('Error', this.error);
      }
    });
  }

  openReportModal(acknowledgment: Acknowledgment): void {
    if (!this.showReportButton) return;
    
    this.selectedAcknowledgment = acknowledgment;
    this.reportReason = '';
    this.reportExtraComments = '';
    this.showReportModal = true;
  }

  closeReportModal(): void {
    this.showReportModal = false;
    this.selectedAcknowledgment = null;
    this.reportReason = '';
    this.reportExtraComments = '';
  }

  submitReport(): void {
    if (!this.selectedAcknowledgment || !this.reportReason.trim()) {
      this.toastService.warning('Advertencia', 'Por favor, selecciona un motivo para el reporte');
      return;
    }

    // Mostrar modal de confirmación antes de enviar
    this.showConfirmModal = true;
  }

  confirmReport(): void {
    if (!this.selectedAcknowledgment) return;

    this.showConfirmModal = false;
    this.reportingId = this.selectedAcknowledgment.id;

    // Usar ReportService con el endpoint correcto /report/create/new
    const reportData = {
      report: this.reportReason.trim(),
      extraComments: this.reportExtraComments.trim() || undefined,
      acknowledgmentId: this.selectedAcknowledgment.id,
      idUser: this.currentUserId ? Number(this.currentUserId) : undefined
    };

    this.reportService.createReport(reportData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          // Marcar como reportado localmente (flag)
          if (this.selectedAcknowledgment) {
            this.reportedAcknowledgmentIds.add(this.selectedAcknowledgment.id);
            this.selectedAcknowledgment.isReported = true;
          }

          // Mostrar modal de éxito
          this.showSuccessModal = true;
          this.reportingId = null;
          
          // Cerrar modal de reporte
          this.closeReportModal();
          
          // Emitir evento
          this.acknowledgmentReported.emit(this.selectedAcknowledgment!.id);
          
          // Recargar para sincronizar con backend
          setTimeout(() => {
            this.loadAcknowledgments();
          }, 2000);
        },
        error: (err) => {
          const errorMsg = err?.error?.message || 'Error al reportar el agradecimiento';
          this.toastService.error('Error', errorMsg);
          this.reportingId = null;
        }
      });
  }

  cancelReport(): void {
    this.showConfirmModal = false;
  }

  closeSuccessModal(): void {
    this.showSuccessModal = false;
  }

  canReport(acknowledgment: Acknowledgment): boolean {
    // Los DONANTES pueden reportar/moderar agradecimientos
    // No se puede reportar si:
    // 1. No está habilitado el botón de reporte
    // 2. No hay usuario autenticado
    // 3. El usuario NO es un donante
    // 4. Es el propio agradecimiento de la organización del usuario (si el usuario es organización)
    // 5. Ya fue reportado (flag local o del backend)
    const isDonor = this.currentUserRole === 'donor' || this.currentUserRole === 'donante' || this.currentUserRole === 'user';
    
    return this.showReportButton && 
           !!this.currentUserId && 
           isDonor && // ✅ SOLO DONANTES pueden reportar/moderar
           acknowledgment.organizationId !== this.currentUserId && // No puede reportar su propio agradecimiento
           !acknowledgment.isReported &&
           !this.reportedAcknowledgmentIds.has(acknowledgment.id);
  }

  isReported(acknowledgment: Acknowledgment): boolean {
    // Verificar flag local o del backend
    return acknowledgment.isReported || this.reportedAcknowledgmentIds.has(acknowledgment.id);
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  trackByAckId(index: number, ack: Acknowledgment): number {
    return ack.id;
  }

  getReportReasonLabel(reason: string): string {
    const labels: { [key: string]: string } = {
      'inappropriate': 'Contenido inapropiado',
      'spam': 'Spam o publicidad',
      'harassment': 'Acoso o intimidación',
      'fake': 'Información falsa',
      'other': 'Otro'
    };
    return labels[reason] || reason;
  }
}

